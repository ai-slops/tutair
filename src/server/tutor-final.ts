import type { z } from "zod";
import { type DiscardedExposure, exposureGroundingFailure } from "./exposure-grounding.js";
import type { KnowledgeContext } from "./tutor-knowledge.js";
import { boundModelContext } from "./tutor-model-context.js";
import { markLintSkipped, unsafeRiskyFinal } from "./tutor-policies.js";
import { type finalSchema, lintedSchema, type planningSchema } from "./tutor-schemas.js";
import type { StageResult, TutorStageRunner } from "./tutor-stage.js";
import { ApiError } from "./types.js";

type FinalReviewRequest = {
  readonly common: Readonly<Record<string, unknown>>;
  readonly plan: z.infer<typeof planningSchema>;
  readonly initialLint: z.infer<typeof lintedSchema>;
  readonly final: StageResult<z.infer<typeof finalSchema>>;
  readonly knowledge: readonly KnowledgeContext[];
};

type ReviewedFinal = {
  readonly final: StageResult<z.infer<typeof finalSchema>> & {
    readonly discardedExposures: readonly DiscardedExposure[];
  };
  readonly knowledge: readonly KnowledgeContext[];
  readonly lintSkipped: boolean;
};

export class TutorFinalReviewer {
  constructor(readonly stages: TutorStageRunner) {}

  async review(request: FinalReviewRequest): Promise<ReviewedFinal> {
    const checked = await this.stages.withFallback({
      stage: "lint",
      schema: lintedSchema,
      data: boundModelContext({
        ...request.common,
        knowledge: request.knowledge,
        draft: request.final.value.text,
        plan: request.plan,
        knownStates: request.common["learnerStates"] ?? [],
        finalReview: true,
      }),
      fallback: {
        safe: false,
        issues: ["lint_skipped"],
        concepts: [],
        generatedCandidates: [],
        lintSkipped: true,
      },
    });
    const knowledge = request.knowledge;
    if (
      unsafeRiskyFinal(checked.value, [
        ...knowledge,
        ...checked.value.generatedCandidates.map((candidate) => ({
          riskScope: candidate.riskScope,
        })),
      ])
    )
      throw new ApiError(
        422,
        "unsafe_tutor_output",
        "Unsafe high-stakes or current-contested tutor output was blocked",
      );
    const allowedKnowledge = knowledge.filter(
      (item) =>
        item.scope === "canonical" ||
        (item.riskScope !== "high-stakes" && item.riskScope !== "current-contested"),
    );
    const allowed = new Set(allowedKnowledge.map((item) => item.id));
    const lintSkipped = request.initialLint.lintSkipped || checked.value.lintSkipped;
    const discardedExposures: DiscardedExposure[] = [];
    const exposures = request.final.value.exposures.filter((exposure) => {
      const reason = exposureGroundingFailure(request.final.value.text, exposure, allowed);
      if (reason === null) return true;
      discardedExposures.push({ knowledgeId: exposure.knowledgeId, reason });
      return false;
    });
    return {
      knowledge: allowedKnowledge,
      lintSkipped,
      final: {
        ...request.final,
        discardedExposures,
        value: {
          ...request.final.value,
          text: markLintSkipped(request.final.value.text, lintSkipped),
          exposures,
        },
      },
    };
  }
}
