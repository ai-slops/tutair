import type { z } from "zod";
import { type DiscardedExposure, exposureGroundingFailure } from "./exposure-grounding.js";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import { knowledgeContext } from "./tutor-knowledge.js";
import { boundModelContext } from "./tutor-model-context.js";
import { markLintSkipped, unsafeRiskyFinal } from "./tutor-policies.js";
import {
  type finalSchema,
  lintedSchema,
  type planningSchema,
  type TurnInput,
} from "./tutor-schemas.js";
import type { StageResult, TutorStageRunner } from "./tutor-stage.js";
import { ApiError } from "./types.js";

type FinalReviewRequest = {
  readonly common: Readonly<Record<string, unknown>>;
  readonly plan: z.infer<typeof planningSchema>;
  readonly initialLint: z.infer<typeof lintedSchema>;
  readonly final: StageResult<z.infer<typeof finalSchema>>;
  readonly allowedKnowledgeIds: readonly string[];
};

type ReviewedFinal = {
  readonly final: StageResult<z.infer<typeof finalSchema>> & {
    readonly discardedExposures: readonly DiscardedExposure[];
  };
  readonly allowedKnowledgeIds: readonly string[];
  readonly lintSkipped: boolean;
};

export class TutorFinalReviewer {
  constructor(
    readonly repository: KnowledgeRepository,
    readonly stages: TutorStageRunner,
    readonly input: TurnInput,
  ) {}

  async review(request: FinalReviewRequest): Promise<ReviewedFinal> {
    const checked = await this.stages.withFallback({
      stage: "lint",
      schema: lintedSchema,
      data: boundModelContext({
        ...request.common,
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
    const knowledge = knowledgeContext(
      this.repository,
      this.input.owner,
      request.allowedKnowledgeIds,
    );
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
    const allowedKnowledgeIds = knowledge
      .filter(
        (item) =>
          item.scope === "canonical" ||
          (item.riskScope !== "high-stakes" && item.riskScope !== "current-contested"),
      )
      .map((item) => item.id);
    const allowed = new Set(allowedKnowledgeIds);
    const lintSkipped = request.initialLint.lintSkipped || checked.value.lintSkipped;
    const discardedExposures: DiscardedExposure[] = [];
    const exposures = request.final.value.exposures.filter((exposure) => {
      const reason = exposureGroundingFailure(request.final.value.text, exposure, allowed);
      if (reason === null) return true;
      discardedExposures.push({ knowledgeId: exposure.knowledgeId, reason });
      return false;
    });
    return {
      allowedKnowledgeIds,
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
