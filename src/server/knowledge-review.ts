import { z } from "zod";
import type { Database } from "./database.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

export const reviewActions = ["reviewed", "mark_incorrect", "retire", "restore"] as const;
export type ReviewAction = (typeof reviewActions)[number];

export type ReviewInput = {
  readonly knowledgeId: string;
  readonly revision: number;
  readonly action: ReviewAction;
  readonly reason: string | null;
  readonly confirmed: boolean;
};

const reviewEventRecord = z.object({
  id: z.string(),
  learner_id: z.string(),
  knowledge_id: z.string(),
  knowledge_revision_id: z.string(),
  revision: z.number(),
  action: z.enum(reviewActions),
  reason: z.string().nullable(),
  created_at: z.string(),
});
type ReviewEvent = z.infer<typeof reviewEventRecord>;

export type ReviewStatus = {
  readonly status: "unreviewed" | "reviewed" | "incorrect" | "retired";
  readonly revision: number;
  readonly revisionId: string;
  readonly reason: string | null;
  readonly updatedAt: string | null;
};

const latestEvent = (
  events: readonly ReviewEvent[],
  actions: readonly ReviewAction[],
  revision?: number,
): ReviewEvent | null =>
  events.find(
    (event) =>
      actions.includes(event.action) && (revision === undefined || event.revision === revision),
  ) ?? null;

export const reviewHistory = (
  db: Database,
  owner: LearnerId,
  knowledgeId: string,
): readonly ReviewEvent[] =>
  db.all(
    "SELECT * FROM knowledge_review_events WHERE learner_id=? AND knowledge_id=? ORDER BY rowid DESC",
    [owner, knowledgeId],
    reviewEventRecord,
  );

export const reviewStatus = (
  db: Database,
  owner: LearnerId,
  knowledgeId: string,
  revision: number,
  revisionId: string,
): ReviewStatus => {
  const events = reviewHistory(db, owner, knowledgeId);
  const lifecycle = latestEvent(events, ["retire", "restore"]);
  if (lifecycle?.action === "retire")
    return {
      status: "retired",
      revision,
      revisionId,
      reason: lifecycle.reason,
      updatedAt: lifecycle.created_at,
    };
  const accuracy = latestEvent(events, ["reviewed", "mark_incorrect"], revision);
  if (accuracy === null)
    return { status: "unreviewed", revision, revisionId, reason: null, updatedAt: null };
  return {
    status: accuracy.action === "reviewed" ? "reviewed" : "incorrect",
    revision,
    revisionId,
    reason: accuracy.reason,
    updatedAt: accuracy.created_at,
  };
};

export const eligibleKnowledgeIds = (
  db: Database,
  owner: LearnerId,
  ids: readonly string[],
): readonly string[] => {
  if (ids.length === 0) return [];
  const placeholders = ids.map(() => "?").join(",");
  return db
    .all(
      `SELECT k.id FROM knowledge_items k WHERE k.id IN (${placeholders})
       AND (k.learner_id IS NULL OR k.learner_id=?)
       AND COALESCE((SELECT action FROM knowledge_review_events e
         WHERE e.learner_id=? AND e.knowledge_id=k.id AND e.action IN('retire','restore')
         ORDER BY e.rowid DESC LIMIT 1),'')<>'retire'
       AND COALESCE((SELECT action FROM knowledge_review_events e
         WHERE e.learner_id=? AND e.knowledge_id=k.id AND e.revision=k.current_revision
           AND e.action IN('reviewed','mark_incorrect')
         ORDER BY e.rowid DESC LIMIT 1),'')<>'mark_incorrect'`,
      [...ids, owner, owner, owner],
      z.object({ id: z.string() }),
    )
    .map((row) => row.id);
};

export const appendReview = (
  db: Database,
  owner: LearnerId,
  revisionId: string,
  input: ReviewInput,
): ReviewEvent => {
  const reason = input.reason?.trim() ?? null;
  if (
    (input.action === "mark_incorrect" || input.action === "retire") &&
    (reason === null || reason.length === 0)
  )
    throw new ApiError(
      422,
      "review_reason_required",
      "A reason is required for incorrect and retire actions",
    );
  const events = reviewHistory(db, owner, input.knowledgeId);
  const lifecycle = latestEvent(events, ["retire", "restore"]);
  if (input.action === "restore" && (!input.confirmed || lifecycle?.action !== "retire"))
    throw new ApiError(
      422,
      "restore_confirmation_required",
      "Restore requires confirmation for a retired knowledge unit",
    );
  const id = newId();
  const createdAt = isoNow();
  db.run("INSERT INTO knowledge_review_events VALUES(?,?,?,?,?,?,?,?)", [
    id,
    owner,
    input.knowledgeId,
    revisionId,
    input.revision,
    input.action,
    reason,
    createdAt,
  ]);
  return reviewEventRecord.parse({
    id,
    learner_id: owner,
    knowledge_id: input.knowledgeId,
    knowledge_revision_id: revisionId,
    revision: input.revision,
    action: input.action,
    reason,
    created_at: createdAt,
  });
};
