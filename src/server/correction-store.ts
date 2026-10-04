import { z } from "zod";
import type { Database } from "./database.js";
import { migrateRevisionMetadata } from "./knowledge-contracts.js";
import type { CorrectionInput } from "./knowledge-inputs.js";
import { knowledgeRecord, revisionRecord } from "./records.js";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

const sourceMessageRecord = z.object({ id: z.string(), conversation_id: z.string() });
const sourceEventRecord = z.object({ id: z.string() });
const evidenceReferenceRecord = z.object({ id: z.string() });

const targetIdFor = (
  db: Database,
  owner: LearnerId,
  input: CorrectionInput,
  priorId: string,
): string => {
  const targetId =
    input.targetId ?? (input.targetType === "revision" ? priorId : input.knowledgeId);
  switch (input.targetType) {
    case "knowledge":
    case "meaning":
      if (targetId !== input.knowledgeId)
        throw new ApiError(422, "invalid_correction_target", "Correction target is not this unit");
      return targetId;
    case "revision":
      if (targetId !== priorId)
        throw new ApiError(
          422,
          "invalid_correction_target",
          "Correction target is not the selected revision",
        );
      return targetId;
    case "evidence": {
      const evidence = db.one(
        "SELECT id FROM evidence WHERE id=? AND learner_id=? AND knowledge_id=? AND knowledge_revision_id=?",
        [targetId, owner, input.knowledgeId, priorId],
        evidenceReferenceRecord,
      );
      if (evidence === null)
        throw new ApiError(
          422,
          "invalid_correction_target",
          "Correction evidence target is not scoped to this learner and revision",
        );
      return evidence.id;
    }
  }
};

export const applyCorrection = (
  db: Database,
  repository: KnowledgeRepository,
  owner: LearnerId,
  input: CorrectionInput,
) => {
  const prior = revisionRecord.parse(repository.revision(owner, input.knowledgeId, input.revision));
  const item = knowledgeRecord.parse(repository.item(owner, input.knowledgeId));
  const sourceMessage =
    input.messageId === undefined
      ? null
      : db.one(
          "SELECT m.id,m.conversation_id FROM messages m JOIN conversations c ON c.id=m.conversation_id AND c.learner_id=m.learner_id WHERE m.id=? AND m.learner_id=? AND m.role='learner'",
          [input.messageId, owner],
          sourceMessageRecord,
        );
  if (input.messageId !== undefined && sourceMessage === null)
    throw new ApiError(
      422,
      "invalid_correction_message",
      "Correction source message is not learner-owned",
    );
  const sourceEvent =
    sourceMessage === null
      ? null
      : db.one(
          "SELECT id FROM message_events WHERE learner_id=? AND message_id=? ORDER BY created_at DESC,id DESC LIMIT 1",
          [owner, sourceMessage.id],
          sourceEventRecord,
        );
  if (sourceMessage !== null && sourceEvent === null)
    throw new ApiError(422, "invalid_correction_snapshot", "Correction source event is missing");
  const uniqueEvidenceIds = [...new Set(input.evidenceIds)];
  const evidenceRows = uniqueEvidenceIds.map((evidenceId) =>
    db.one(
      "SELECT id FROM evidence WHERE id=? AND learner_id=? AND knowledge_id=? AND knowledge_revision_id=?",
      [evidenceId, owner, input.knowledgeId, prior.id],
      evidenceReferenceRecord,
    ),
  );
  if (evidenceRows.some((row) => row === null))
    throw new ApiError(
      422,
      "invalid_correction_evidence",
      "Correction evidence is not scoped to this learner and revision",
    );
  const targetId = targetIdFor(db, owner, input, prior.id);
  const priorMetadata = migrateRevisionMetadata(prior);
  const sourceDetails = {
    title: item.title,
    statement: input.statement,
    riskScope: item.risk_scope,
    confidence: item.confidence,
    kind: item.kind,
    sourceType: "learner_manual" as const,
    ...(sourceMessage === null ? {} : { sourceMessageIds: [sourceMessage.id] }),
    ...(sourceEvent === null ? {} : { sourceMessageEventIds: [sourceEvent.id] }),
  };
  const revisionDetails = {
    ...sourceDetails,
    semanticScope: priorMetadata.semanticScope,
    definitionScope: priorMetadata.definitionScope,
    distinguishingFeatures: z
      .array(z.string())
      .parse(JSON.parse(prior.distinguishing_features_json)),
    claims: priorMetadata.claims,
    sourceRefs: z.array(z.string()).parse(JSON.parse(prior.source_refs_json)),
    ...(sourceMessage === null ? {} : { conversationId: sourceMessage.conversation_id }),
  };
  return db.transaction(() => {
    const result =
      input.kind === "revise"
        ? {
            item,
            revision: repository.addRevision(owner, {
              knowledgeId: input.knowledgeId,
              statement: input.statement,
              sourceType: "learner_correction:revise",
              sourceRef: sourceMessage?.id ?? null,
              details: revisionDetails,
            }),
          }
        : input.kind === "meaning_mismatch"
          ? repository.create(owner, sourceDetails)
          : { item, revision: prior };
    const next = revisionRecord.parse(result.revision);
    const correction = {
      ...input,
      id: newId(),
      targetId,
      fromRevision: input.revision,
      toRevision: next.revision,
      createdAt: isoNow(),
    };
    db.run("INSERT INTO corrections VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)", [
      correction.id,
      owner,
      input.knowledgeId,
      input.kind,
      input.targetType,
      targetId,
      prior.id,
      next.id,
      input.statement,
      input.reason,
      sourceMessage?.id ?? null,
      sourceEvent?.id ?? null,
      correction.createdAt,
    ]);
    for (const evidenceId of uniqueEvidenceIds)
      db.run("INSERT INTO evidence_invalidations VALUES(?,?,?,?,?)", [
        newId(),
        owner,
        evidenceId,
        correction.id,
        correction.createdAt,
      ]);
    if (input.kind === "meaning_mismatch") {
      const createdItem = knowledgeRecord.parse(result.item);
      repository.rebuild(owner, createdItem.id);
    }
    repository.rebuild(owner, input.knowledgeId);
    return { correction, item: result.item, revision: result.revision };
  });
};
