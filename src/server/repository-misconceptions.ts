import { createHash } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database.js";
import {
  type MisconceptionReviewAction,
  type MisconceptionRevisionInput,
  misconceptionReviewSchema,
  misconceptionRevisionInputSchema,
} from "./misconception-contracts.js";
import { misconceptionIdentityRow, presentMisconception } from "./misconception-projection.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

export class MisconceptionRepository {
  constructor(readonly db: Database) {}

  createOrReuse(owner: LearnerId, raw: MisconceptionRevisionInput) {
    const input = misconceptionRevisionInputSchema.parse(raw);
    this.assertLinks(owner, input);
    const fingerprint = this.fingerprint(input);
    const existing = this.db.one(
      "SELECT * FROM misconceptions WHERE learner_id=? AND fingerprint=?",
      [owner, fingerprint],
      misconceptionIdentityRow,
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
        misconceptionIdentityRow,
      )
      .map((row) => presentMisconception(this.db, owner, row));
  }

  eligible(owner: LearnerId) {
    return this.list(owner).filter((item) => item.eligibilityReason === null);
  }

  get(owner: LearnerId, id: string) {
    return presentMisconception(this.db, owner, this.identity(owner, id));
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
      misconceptionIdentityRow,
    );
    if (row === null) throw new ApiError(404, "misconception_not_found", "Misconception not found");
    return row;
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
