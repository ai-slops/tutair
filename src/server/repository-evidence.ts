import { z } from "zod";
import type { Database } from "./database.js";
import type { NewEvidence } from "./knowledge-inputs.js";
import { evidenceWeight } from "./learner-projection.js";
import { rebuildProjections } from "./projection-store.js";
import { evidenceRecord, knowledgeRecord } from "./records.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

const sourceRecord = z.object({
  conversation_id: z.string(),
  role: z.literal("learner"),
  tombstoned_at: z.null(),
});
const eventRecord = z.object({ id: z.string() });
const ownedIdRecord = z.object({ id: z.string() });

export const listEvidence = (
  db: Database,
  query: {
    readonly owner: LearnerId;
    readonly knowledgeId?: string;
    readonly revision?: number;
  },
): readonly unknown[] => {
  const filters = ["learner_id=?"];
  const values: (string | number)[] = [query.owner];
  if (query.knowledgeId !== undefined) {
    filters.push("knowledge_id=?");
    values.push(query.knowledgeId);
  }
  if (query.revision !== undefined) {
    filters.push("revision=?");
    values.push(query.revision);
  }
  return db.all(
    `SELECT * FROM evidence WHERE ${filters.join(" AND ")} ORDER BY created_at,id`,
    values,
    evidenceRecord,
  );
};

export const insertEvidence = (db: Database, owner: LearnerId, input: NewEvidence): unknown => {
  const revision = db.one(
    "SELECT id FROM knowledge_revisions WHERE id=? AND knowledge_id=? AND revision=? AND knowledge_id IN (SELECT id FROM knowledge_items WHERE learner_id IS NULL OR learner_id=?)",
    [input.knowledgeRevisionId, input.knowledgeId, input.revision, owner],
    z.object({ id: z.string() }),
  );
  const message = db.one(
    "SELECT conversation_id,role,tombstoned_at FROM messages WHERE id=? AND learner_id=?",
    [input.messageId, owner],
    sourceRecord,
  );
  if (revision === null || message === null || message.conversation_id !== input.conversationId) {
    throw new ApiError(
      422,
      "invalid_evidence_source",
      "Evidence provenance does not match its source",
    );
  }
  const sourceEvent =
    input.messageEventId === undefined
      ? db.one(
          "SELECT id FROM message_events WHERE message_id=? AND learner_id=? ORDER BY created_at DESC,id DESC LIMIT 1",
          [input.messageId, owner],
          eventRecord,
        )
      : db.one(
          "SELECT id FROM message_events WHERE id=? AND message_id=? AND learner_id=?",
          [input.messageEventId, input.messageId, owner],
          eventRecord,
        );
  if (sourceEvent === null) {
    throw new ApiError(
      422,
      "invalid_evidence_snapshot",
      "Evidence requires an immutable message event",
    );
  }
  if (
    input.threadId !== undefined &&
    db.one(
      "SELECT id FROM threads WHERE id=? AND learner_id=?",
      [input.threadId, owner],
      ownedIdRecord,
    ) === null
  ) {
    throw new ApiError(422, "invalid_evidence_thread", "Evidence thread is not learner-owned");
  }
  if (
    input.evaluator.modelRunId !== undefined &&
    input.evaluator.modelRunId !== null &&
    db.one(
      "SELECT id FROM model_runs WHERE id=? AND learner_id=?",
      [input.evaluator.modelRunId, owner],
      ownedIdRecord,
    ) === null
  ) {
    throw new ApiError(422, "invalid_evaluator_run", "Evaluator run is not learner-owned");
  }
  for (const relatedId of input.relatedUnitIds) {
    if (
      db.one(
        "SELECT id FROM knowledge_items WHERE id=? AND (learner_id IS NULL OR learner_id=?)",
        [relatedId, owner],
        ownedIdRecord,
      ) === null
    ) {
      throw new ApiError(422, "invalid_related_unit", "Related unit is not visible to the learner");
    }
  }
  const createdAt = isoNow();
  const projectionEvidence = {
    id: newId(),
    knowledgeRevisionId: input.knowledgeRevisionId,
    dimension: input.dimension,
    evidenceType: input.evidenceType,
    score: input.score,
    evaluatorConfidence: input.evaluatorConfidence,
    polarity: input.polarity,
    assistance: input.assistance,
    contextDiscount: input.contextDiscount ?? 1,
    createdAt,
  };
  const values = [
    projectionEvidence.id,
    owner,
    input.knowledgeId,
    input.knowledgeRevisionId,
    input.revision,
    input.conversationId,
    input.messageId,
    sourceEvent.id,
    input.assessmentId ?? null,
    input.dimension,
    input.evidenceType,
    input.score,
    input.polarity,
    input.strength,
    input.evaluatorConfidence,
    input.evaluator.type,
    input.evaluator.modelRunId ?? null,
    input.evaluator.rubricVersion,
    input.assistance.hints,
    input.assistance.answerVisible ? 1 : 0,
    input.assistance.openBook ? 1 : 0,
    input.assistance.copiedFromRecentContext ? 1 : 0,
    JSON.stringify(input.supportingSpans),
    JSON.stringify(input.limitations),
    JSON.stringify(input.relatedUnitIds),
    input.threadId ?? null,
    input.difficulty ?? null,
    input.contextDiscount ?? 1,
    evidenceWeight(projectionEvidence),
    createdAt,
  ];
  db.transaction(() => {
    if (input.assessmentId !== undefined) {
      const assessment = db.one(
        "SELECT id FROM assessments WHERE id=? AND learner_id=?",
        [input.assessmentId, owner],
        ownedIdRecord,
      );
      if (assessment === null)
        db.run("INSERT INTO assessments VALUES(?,?,?,?,?,?)", [
          input.assessmentId,
          owner,
          input.conversationId,
          input.threadId ?? null,
          "{}",
          createdAt,
        ]);
    }
    db.run(`INSERT INTO evidence VALUES(${values.map(() => "?").join(",")})`, values);
    rebuildEvidenceProjections(db, owner, input.knowledgeId);
  });
  return db.one("SELECT * FROM evidence WHERE id=?", [projectionEvidence.id], evidenceRecord);
};

export const rebuildEvidenceProjections = (
  db: Database,
  owner: LearnerId,
  knowledgeId?: string,
): number => {
  const rows = db.all(
    `SELECT * FROM knowledge_items WHERE (learner_id IS NULL OR learner_id=?)${
      knowledgeId === undefined ? "" : " AND id=?"
    } ORDER BY title`,
    knowledgeId === undefined ? [owner] : [owner, knowledgeId],
    knowledgeRecord,
  );
  if (knowledgeId !== undefined && rows.length === 0) {
    throw new ApiError(404, "knowledge_not_found", "Knowledge item not found");
  }
  return rebuildProjections(db, owner, rows);
};
