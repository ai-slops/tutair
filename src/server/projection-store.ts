import { z } from "zod";
import type { Database } from "./database.js";
import {
  knowledgeDimensions,
  type ProjectionCorrection,
  type ProjectionEvidence,
  projectionVersion,
  projectKnowledge,
} from "./learner-projection.js";
import { evidenceRecord, knowledgeRecord } from "./records.js";
import type { LearnerId } from "./types.js";
import { isoNow, newId } from "./types.js";

export const rebuildProjections = (
  db: Database,
  owner: LearnerId,
  rawItems: readonly unknown[],
): number => {
  let rebuilt = 0;
  for (const raw of rawItems) {
    const item = knowledgeRecord.parse(raw);
    const revision = db.one(
      "SELECT id FROM knowledge_revisions WHERE knowledge_id=? AND revision=?",
      [item.id, item.current_revision],
      z.object({ id: z.string() }),
    );
    if (revision === null) continue;
    const revisionId = revision.id;
    const rows = db.all(
      "SELECT * FROM evidence WHERE learner_id=? AND knowledge_id=? AND revision=?",
      [owner, item.id, item.current_revision],
      evidenceRecord,
    );
    const evidence: ProjectionEvidence[] = rows.map((row) => ({
      id: row.id,
      knowledgeRevisionId: row.knowledge_revision_id,
      dimension: row.dimension,
      evidenceType: row.evidence_type,
      score: row.score,
      evaluatorConfidence: row.evaluator_confidence,
      polarity: row.polarity,
      assistance: {
        hints: row.hints,
        answerVisible: row.answer_visible === 1,
        openBook: row.open_book === 1,
        copiedFromRecentContext: row.copied_from_recent_context === 1,
      },
      contextDiscount: row.context_discount,
      createdAt: row.created_at,
    }));
    const invalid = db.all(
      "SELECT evidence_id,created_at FROM evidence_invalidations WHERE learner_id=? AND evidence_id IN (SELECT id FROM evidence WHERE knowledge_id=? AND revision=?)",
      [owner, item.id, item.current_revision],
      z.object({ evidence_id: z.string(), created_at: z.string() }),
    );
    const corrections: ProjectionCorrection[] = invalid.map((row) => ({
      type: "evidence_invalid",
      evidenceId: row.evidence_id,
      createdAt: row.created_at,
    }));
    const correctionRows = db.all(
      "SELECT correction_type,created_at FROM corrections WHERE learner_id=? AND knowledge_id=? AND (to_revision_id=? OR (correction_type='meaning_mismatch' AND from_revision_id=?))",
      [owner, item.id, revisionId, revisionId],
      z.object({ correction_type: z.string(), created_at: z.string() }),
    );
    for (const row of correctionRows) {
      if (row.correction_type === "claim_less")
        corrections.push({ type: "claims_less_knowledge", createdAt: row.created_at });
      else if (row.correction_type === "claim_more")
        corrections.push({ type: "claims_more_knowledge", createdAt: row.created_at });
      else if (row.correction_type === "meaning_mismatch")
        corrections.push({ type: "meaning_mismatch", createdAt: row.created_at });
    }
    const exposures = db
      .all(
        "SELECT created_at FROM exposures WHERE learner_id=? AND knowledge_id=? AND revision=?",
        [owner, item.id, item.current_revision],
        z.object({ created_at: z.string() }),
      )
      .map((row) => ({ knowledgeRevisionId: revisionId, createdAt: row.created_at }));
    const projection = projectKnowledge({
      knowledgeRevisionId: revisionId,
      authority: item.scope,
      riskScope: item.risk_scope,
      evidence,
      exposures,
      corrections,
      now: isoNow(),
    });
    let combined = 0;
    let observed = 0;
    for (const dimension of knowledgeDimensions) {
      const state = projection.dimensions[dimension];
      const evidenceIds = rows
        .filter((row) => row.dimension === dimension && projection.evidenceIds.includes(row.id))
        .map((row) => row.id);
      db.run(
        "INSERT INTO learner_state(id,learner_id,knowledge_id,knowledge_revision_id,revision,dimension,estimate,uncertainty,status,effective_evidence,last_observation,evidence_ids_json,projection_version,projected_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(learner_id,knowledge_id,revision,dimension) DO UPDATE SET knowledge_revision_id=excluded.knowledge_revision_id,estimate=excluded.estimate,uncertainty=excluded.uncertainty,status=excluded.status,effective_evidence=excluded.effective_evidence,last_observation=excluded.last_observation,evidence_ids_json=excluded.evidence_ids_json,projection_version=excluded.projection_version,projected_at=excluded.projected_at",
        [
          newId(),
          owner,
          item.id,
          revisionId,
          item.current_revision,
          dimension,
          state.estimate,
          state.uncertainty,
          state.status,
          state.effectiveEvidence,
          state.lastObservedAt ?? null,
          JSON.stringify(evidenceIds),
          projectionVersion,
          projection.updatedAt,
        ],
      );
      if (state.effectiveEvidence > 0) {
        combined += state.estimate;
        observed += 1;
      }
    }
    if (item.learner_id === owner)
      db.run("UPDATE knowledge_items SET mastery=?,confidence=? WHERE id=? AND learner_id=?", [
        observed === 0 ? 0 : combined / observed,
        Math.min(1, observed / 6),
        item.id,
        owner,
      ]);
    rebuilt += 1;
  }
  return rebuilt;
};
