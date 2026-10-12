import { createHash } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database.js";
import { eligibleKnowledgeIds } from "./knowledge-review.js";
import {
  type MisconceptionReviewAction,
  type MisconceptionRevisionInput,
  misconceptionReviewSchema,
  misconceptionRevisionInputSchema,
} from "./misconception-contracts.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

const identityRow = z.object({
  id: z.string(),
  learner_id: z.string(),
  current_revision: z.number(),
  created_at: z.string(),
});
const revisionRow = z.object({
  id: z.string(),
  misconception_id: z.string(),
  revision: z.number(),
  label: z.string(),
  mistaken_proposition: z.string(),
  correction: z.string(),
  failure_task: z.string(),
  likely_error: z.string(),
  discriminating_example_json: z.string(),
  reuse_value_reason: z.string(),
  source_refs_json: z.string(),
  source_type: z.string(),
  extraction_run_id: z.string().nullable(),
  resolution_run_id: z.string().nullable(),
  model_review_json: z.string().nullable(),
  created_at: z.string(),
});
const linkRow = z.object({
  definition_revision_id: z.string(),
  role: z.enum(["subject", "contrast", "correction_basis"]),
  learning_value: z.string(),
  knowledge_id: z.string(),
  current_revision_id: z.string(),
});
const reviewRow = z.object({
  id: z.string(),
  action: z.enum(["reviewed", "mark_incorrect", "retire", "restore"]),
  reason: z.string().nullable(),
  misconception_revision_id: z.string(),
  created_at: z.string(),
});

export class MisconceptionRepository {
  constructor(readonly db: Database) {}

  createOrReuse(owner: LearnerId, raw: MisconceptionRevisionInput) {
    const input = misconceptionRevisionInputSchema.parse(raw);
    this.assertLinks(owner, input);
    const fingerprint = this.fingerprint(input);
    const existing = this.db.one(
      "SELECT * FROM misconceptions WHERE learner_id=? AND fingerprint=?",
      [owner, fingerprint],
      identityRow,
    );
    if (existing !== null) return this.get(owner, existing.id);
    return this.db.transaction(() => {
      const id = newId();
      const now = isoNow();
      this.db.run("INSERT INTO misconceptions VALUES(?,?,?,?,?)", [id, owner, fingerprint, 1, now]);
      this.insertRevision(id, 1, input, now);
      return this.get(owner, id);
    });
  }

  correct(owner: LearnerId, id: string, raw: MisconceptionRevisionInput) {
    const prior = this.identity(owner, id);
    const input = misconceptionRevisionInputSchema.parse(raw);
    this.assertLinks(owner, input);
    const next = prior.current_revision + 1;
    this.db.transaction(() => {
      this.insertRevision(id, next, input, isoNow());
      this.db.run(
        "UPDATE misconceptions SET current_revision=?,fingerprint=? WHERE id=? AND learner_id=?",
        [next, this.fingerprint(input), id, owner],
      );
    });
    return this.get(owner, id);
  }

  list(owner: LearnerId) {
    return this.db
      .all(
        "SELECT * FROM misconceptions WHERE learner_id=? ORDER BY created_at,id",
        [owner],
        identityRow,
      )
      .map((row) => this.present(owner, row));
  }

  eligible(owner: LearnerId) {
    return this.list(owner).filter((item) => item.eligibilityReason === null);
  }

  get(owner: LearnerId, id: string) {
    return this.present(owner, this.identity(owner, id));
  }

  review(
    owner: LearnerId,
    id: string,
    action: MisconceptionReviewAction,
    reason: string | null,
    confirmed: boolean,
  ) {
    const item = this.get(owner, id);
    misconceptionReviewSchema.parse({ action, reason, confirmed });
    const eventId = newId();
    const now = isoNow();
    this.db.run("INSERT INTO misconception_review_events VALUES(?,?,?,?,?,?,?)", [
      eventId,
      id,
      item.revisionId,
      owner,
      action,
      reason,
      now,
    ]);
    return { id: eventId, action, reason, revisionId: item.revisionId, createdAt: now };
  }

  private identity(owner: LearnerId, id: string) {
    const row = this.db.one(
      "SELECT * FROM misconceptions WHERE id=? AND learner_id=?",
      [id, owner],
      identityRow,
    );
    if (row === null) throw new ApiError(404, "misconception_not_found", "Misconception not found");
    return row;
  }

  private present(owner: LearnerId, identity: z.infer<typeof identityRow>) {
    const revision = this.db.one(
      "SELECT * FROM misconception_revisions WHERE misconception_id=? AND revision=?",
      [identity.id, identity.current_revision],
      revisionRow,
    );
    if (revision === null)
      throw new ApiError(
        500,
        "misconception_revision_missing",
        "Current misconception revision is missing",
      );
    const links = this.db.all(
      `SELECT l.*,r.knowledge_id,(SELECT cr.id FROM knowledge_revisions cr JOIN knowledge_items ci ON ci.id=cr.knowledge_id WHERE ci.id=r.knowledge_id AND cr.revision=ci.current_revision) AS current_revision_id
       FROM misconception_definition_links l JOIN knowledge_revisions r ON r.id=l.definition_revision_id WHERE l.misconception_revision_id=? ORDER BY l.role,l.definition_revision_id`,
      [revision.id],
      linkRow,
    );
    const reviews = this.db.all(
      "SELECT id,action,reason,misconception_revision_id,created_at FROM misconception_review_events WHERE misconception_id=? AND learner_id=? ORDER BY created_at,id",
      [identity.id, owner],
      reviewRow,
    );
    const currentReviews = reviews.filter(
      (event) => event.misconception_revision_id === revision.id,
    );
    const retired =
      reviews.toReversed().find((event) => event.action === "retire" || event.action === "restore")
        ?.action === "retire";
    const latest = currentReviews.at(-1);
    const linkedKnowledgeEligible = new Set(
      eligibleKnowledgeIds(
        this.db,
        owner,
        links.map((link) => link.knowledge_id),
      ),
    );
    const stale = links.some(
      (link) =>
        link.definition_revision_id !== link.current_revision_id ||
        !linkedKnowledgeEligible.has(link.knowledge_id),
    );
    const eligibilityReason = retired
      ? "retired"
      : latest?.action === "mark_incorrect"
        ? "incorrect"
        : stale
          ? "stale_definition_link"
          : null;
    return {
      id: identity.id,
      revision: revision.revision,
      revisionId: revision.id,
      label: revision.label,
      mistakenProposition: revision.mistaken_proposition,
      correction: revision.correction,
      failureTask: revision.failure_task,
      likelyError: revision.likely_error,
      discriminatingExample: z
        .object({
          scenario: z.string(),
          mistakenResponse: z.string(),
          correctedResponse: z.string(),
          decisiveCue: z.string(),
        })
        .parse(JSON.parse(revision.discriminating_example_json)),
      reuseValueReason: revision.reuse_value_reason,
      sourceRefs: z.array(z.string()).parse(JSON.parse(revision.source_refs_json)),
      sourceType: revision.source_type,
      definitionRevisionLinks: links.map((link) => ({
        definitionRevisionId: link.definition_revision_id,
        role: link.role,
        learningValue: link.learning_value,
      })),
      reviewStatus: retired
        ? "retired"
        : latest?.action === "mark_incorrect"
          ? "incorrect"
          : latest?.action === "reviewed"
            ? "reviewed"
            : "unreviewed",
      reviewHistory: reviews.map((event) => ({
        id: event.id,
        action: event.action,
        reason: event.reason,
        createdAt: event.created_at,
      })),
      eligibilityReason,
      createdAt: identity.created_at,
    };
  }

  private assertLinks(owner: LearnerId, input: MisconceptionRevisionInput): void {
    for (const link of input.definitionRevisionLinks) {
      const row = this.db.one(
        `SELECT r.id,k.kind,k.learner_id FROM knowledge_revisions r JOIN knowledge_items k ON k.id=r.knowledge_id WHERE r.id=?`,
        [link.definitionRevisionId],
        z.object({ id: z.string(), kind: z.string(), learner_id: z.string().nullable() }),
      );
      if (
        row === null ||
        (row.learner_id !== null && row.learner_id !== owner) ||
        !["concept", "term_sense"].includes(row.kind)
      )
        throw new ApiError(
          422,
          "invalid_misconception_definition_link",
          "Misconceptions may link only to accessible definition revisions",
        );
    }
  }

  private insertRevision(
    id: string,
    revision: number,
    input: MisconceptionRevisionInput,
    now: string,
  ): void {
    const revisionId = newId();
    this.db.run("INSERT INTO misconception_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
      revisionId,
      id,
      revision,
      input.label,
      input.mistakenProposition,
      input.correction,
      input.failureTask,
      input.likelyError,
      JSON.stringify(input.discriminatingExample),
      input.reuseValueReason,
      JSON.stringify(input.sourceRefs),
      input.sourceType,
      input.extractionRunId,
      input.resolutionRunId,
      input.modelReview === null ? null : JSON.stringify(input.modelReview),
      now,
    ]);
    for (const link of input.definitionRevisionLinks)
      this.db.run("INSERT INTO misconception_definition_links VALUES(?,?,?,?)", [
        revisionId,
        link.definitionRevisionId,
        link.role,
        link.learningValue,
      ]);
    const anchor = input.definitionRevisionLinks.find((link) => link.role === "subject");
    if (anchor === undefined) return;
    const blocks = [
      ["misconception", input.mistakenProposition],
      ["correction", input.correction],
      ["failure_task", input.failureTask],
      ["likely_error", input.likelyError],
      ["example", JSON.stringify(input.discriminatingExample)],
    ] as const;
    blocks.forEach(([type, content], position) => {
      this.db.run("INSERT INTO misconception_blocks VALUES(?,?,?,?,?,?,?,?,?)", [
        newId(),
        revisionId,
        position,
        type,
        content,
        createHash("sha256").update(content).digest("hex"),
        "en",
        null,
        anchor.definitionRevisionId,
      ]);
    });
  }

  private fingerprint(input: MisconceptionRevisionInput): string {
    return createHash("sha256")
      .update(
        JSON.stringify({
          label: input.label,
          mistakenProposition: input.mistakenProposition,
          correction: input.correction,
          failureTask: input.failureTask,
          likelyError: input.likelyError,
          discriminatingExample: input.discriminatingExample,
          reuseValueReason: input.reuseValueReason,
          links: input.definitionRevisionLinks.toSorted((a, b) =>
            a.definitionRevisionId.localeCompare(b.definitionRevisionId),
          ),
        }),
      )
      .digest("hex");
  }
}
