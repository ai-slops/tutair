import { z } from "zod";
import type { Database } from "./database.js";
import { eligibleKnowledgeIds } from "./knowledge-review.js";
import type { LearnerId } from "./types.js";
import { ApiError } from "./types.js";

export const misconceptionIdentityRow = z.object({
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

export function presentMisconception(
  db: Database,
  owner: LearnerId,
  identity: z.infer<typeof misconceptionIdentityRow>,
) {
  const revision = db.one(
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
  const links = db.all(
    `SELECT l.*,r.knowledge_id,(SELECT cr.id FROM knowledge_revisions cr JOIN knowledge_items ci ON ci.id=cr.knowledge_id WHERE ci.id=r.knowledge_id AND cr.revision=ci.current_revision) AS current_revision_id
     FROM misconception_definition_links l JOIN knowledge_revisions r ON r.id=l.definition_revision_id WHERE l.misconception_revision_id=? ORDER BY l.role,l.definition_revision_id`,
    [revision.id],
    linkRow,
  );
  const reviews = db.all(
    "SELECT id,action,reason,misconception_revision_id,created_at FROM misconception_review_events WHERE misconception_id=? AND learner_id=? ORDER BY rowid",
    [identity.id, owner],
    reviewRow,
  );
  const currentReviews = reviews.filter((event) => event.misconception_revision_id === revision.id);
  const retired =
    reviews.toReversed().find((event) => event.action === "retire" || event.action === "restore")
      ?.action === "retire";
  const latestAccuracy = currentReviews
    .filter((event) => event.action === "reviewed" || event.action === "mark_incorrect")
    .at(-1);
  const linkedKnowledgeEligible = new Set(
    eligibleKnowledgeIds(
      db,
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
    : latestAccuracy?.action === "mark_incorrect"
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
      : latestAccuracy?.action === "mark_incorrect"
        ? "incorrect"
        : latestAccuracy?.action === "reviewed"
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
