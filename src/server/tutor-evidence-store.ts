import type { z } from "zod";
import type { evaluatedSchema } from "./evaluation-schema.js";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import type { KnowledgeContext } from "./tutor-knowledge.js";
import type { TurnInput } from "./tutor-schemas.js";
import type { StageResult } from "./tutor-stage.js";
import { isoNow, newId } from "./types.js";

export class TutorEvidenceStore {
  constructor(readonly knowledge: KnowledgeRepository) {}

  record(
    input: TurnInput,
    evaluated: StageResult<z.infer<typeof evaluatedSchema>>,
    offered: readonly KnowledgeContext[],
  ) {
    return this.knowledge.db.transaction(() => {
      const evaluation = evaluated.value;
      const skipped = evaluated.runId === "fallback";
      for (const item of evaluation.evidence)
        this.knowledge.addEvidence(input.owner, {
          knowledgeId: item.knowledgeId,
          knowledgeRevisionId: item.knowledgeRevisionId,
          revision: item.revision,
          conversationId: input.conversationId,
          messageId: input.messageId,
          ...(input.messageEventId === undefined ? {} : { messageEventId: input.messageEventId }),
          dimension: item.dimension,
          evidenceType: item.evidenceType,
          score: item.score,
          polarity: item.ambiguous ? "ambiguous" : item.polarity,
          strength: item.score,
          evaluatorConfidence: item.evaluatorConfidence,
          evaluator: {
            type: skipped ? "rule" : "model",
            ...(skipped ? {} : { modelRunId: evaluated.runId }),
            rubricVersion: "phase1-evidence-v1",
          },
          assistance: {
            hints: input.assistance === "hint" ? 1 : 0,
            answerVisible: input.assistance === "worked_example",
            openBook: input.assistance !== "none",
            copiedFromRecentContext: item.copied,
          },
          supportingSpans: item.sourceSpans,
          limitations: item.limitations,
          relatedUnitIds: item.relatedKnowledgeIds,
          ...(item.assessmentId === null ? {} : { assessmentId: item.assessmentId }),
          ...(item.threadId === null ? {} : { threadId: item.threadId }),
          difficulty: item.difficulty,
        });
      const followup = evaluation.suggestedFollowup;
      const target = offered.find((item) => item.id === followup?.knowledgeUnitId);
      const accepted = followup !== null && target !== undefined;
      this.knowledge.db.run("INSERT INTO traces VALUES(?,?,?,?,?,?)", [
        newId(),
        input.owner,
        skipped ? null : evaluated.runId,
        "evaluation_outcome",
        JSON.stringify({
          conversationId: input.conversationId,
          messageId: input.messageId,
          evaluationSkipped: skipped,
          unresolvedAmbiguities: evaluation.unresolvedAmbiguities,
          suggestedFollowup: followup,
          followupAccepted: accepted,
          knowledgeRevisionId: target?.revisionId ?? null,
        }),
        isoNow(),
      ]);
      return {
        followupQuestion: accepted
          ? `${target.title}: ${followup.method} (${followup.dimension})`
          : null,
        followupTrackingSkipped: followup !== null && !accepted,
      };
    });
  }
}
