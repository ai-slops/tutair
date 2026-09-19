export const knowledgeDimensions = [
  "recognition",
  "recall",
  "explanation",
  "application",
  "discrimination",
  "transfer",
] as const;
export type KnowledgeDimension = (typeof knowledgeDimensions)[number];

export type ProjectionEvidence = {
  readonly id: string;
  readonly knowledgeRevisionId: string;
  readonly dimension: KnowledgeDimension;
  readonly evidenceType:
    | "self_report"
    | "recognition_response"
    | "free_explanation"
    | "application"
    | "contrast"
    | "prediction"
    | "artifact"
    | "execution_result";
  readonly score: number;
  readonly evaluatorConfidence: number;
  readonly polarity: "positive" | "negative" | "ambiguous";
  readonly assistance: {
    readonly hints: number;
    readonly answerVisible: boolean;
    readonly openBook: boolean;
    readonly copiedFromRecentContext: boolean;
  };
  readonly contextDiscount?: number;
  readonly createdAt: string;
};

export type ProjectionCorrection =
  | { readonly type: "evidence_invalid"; readonly evidenceId: string; readonly createdAt: string }
  | {
      readonly type: "claims_more_knowledge" | "claims_less_knowledge" | "meaning_mismatch";
      readonly createdAt: string;
    };

export type ProjectionInput = {
  readonly knowledgeRevisionId: string;
  readonly authority?: "canonical" | "provisional";
  readonly riskScope?: "stable" | "definition-sensitive" | "current-contested" | "high-stakes";
  readonly evidence: readonly ProjectionEvidence[];
  readonly exposures: readonly {
    readonly knowledgeRevisionId: string;
    readonly createdAt: string;
  }[];
  readonly corrections: readonly ProjectionCorrection[];
  readonly now: string;
};

export type DimensionState = {
  readonly estimate: number;
  readonly uncertainty: number;
  readonly status: "unknown" | "exposed" | "tentative" | "supported" | "stale";
  readonly effectiveEvidence: number;
  readonly lastObservedAt?: string;
};

export const projectionVersion = "weighted-revision-dimensions-v2-risk";

const typeWeights = {
  self_report: 0.2,
  recognition_response: 0.4,
  free_explanation: 0.8,
  application: 1,
  contrast: 0.9,
  prediction: 0.8,
  artifact: 1,
  execution_result: 1,
} as const;

export function evidenceWeight(evidence: ProjectionEvidence): number {
  const assistance = evidence.assistance;
  const helpDiscount =
    ((assistance.answerVisible ? 0.25 : 1) / (1 + assistance.hints * 0.5)) *
    (assistance.openBook ? 0.7 : 1);
  const copyingDiscount = assistance.copiedFromRecentContext ? 0.1 : 1;
  const ambiguityDiscount = evidence.polarity === "ambiguous" ? 0.05 : 1;
  const transferWeight = evidence.dimension === "transfer" ? 1.2 : 1;
  return (
    typeWeights[evidence.evidenceType] *
    evidence.evaluatorConfidence *
    helpDiscount *
    copyingDiscount *
    ambiguityDiscount *
    transferWeight *
    (evidence.contextDiscount ?? 1)
  );
}

export function projectKnowledge(input: ProjectionInput) {
  const invalid = new Set<string>();
  let mismatchAfter = "";
  let confidenceCorrectionAfter = "";
  let confidenceClaimAfter = "";
  for (const correction of input.corrections) {
    switch (correction.type) {
      case "evidence_invalid":
        invalid.add(correction.evidenceId);
        break;
      case "meaning_mismatch":
        if (correction.createdAt > mismatchAfter) mismatchAfter = correction.createdAt;
        break;
      case "claims_less_knowledge":
        if (correction.createdAt > confidenceCorrectionAfter) {
          confidenceCorrectionAfter = correction.createdAt;
        }
        break;
      case "claims_more_knowledge":
        if (correction.createdAt > confidenceClaimAfter)
          confidenceClaimAfter = correction.createdAt;
        break;
      default: {
        const unreachable: never = correction;
        return unreachable;
      }
    }
  }
  const relevant = input.evidence
    .filter((item) => item.knowledgeRevisionId === input.knowledgeRevisionId)
    .filter((item) => !invalid.has(item.id) && item.createdAt > mismatchAfter)
    .toSorted((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const exposures = input.exposures.filter(
    (item) => item.knowledgeRevisionId === input.knowledgeRevisionId,
  );

  function dimensionState(dimension: KnowledgeDimension): DimensionState {
    const observations = relevant.filter((item) => item.dimension === dimension);
    let positive = 0;
    let negative = 0;
    for (const observation of observations) {
      const weight = evidenceWeight(observation);
      positive += weight * observation.score;
      negative += weight * (1 - observation.score);
    }
    const effectiveEvidence = positive + negative;
    const estimate = (1 + positive) / (2 + effectiveEvidence);
    const lastObservedAt = observations.at(-1)?.createdAt;
    const corrected = lastObservedAt !== undefined && confidenceCorrectionAfter >= lastObservedAt;
    const restricted =
      input.authority === "provisional" &&
      (input.riskScope === "current-contested" || input.riskScope === "high-stakes");
    const recentClaim =
      dimension === "recognition" &&
      confidenceClaimAfter > confidenceCorrectionAfter &&
      confidenceClaimAfter > (lastObservedAt ?? "") &&
      Date.parse(input.now) - Date.parse(confidenceClaimAfter) <= 90 * 86400_000;
    const uncertainty = Math.max(
      1 / (1 + effectiveEvidence) - (recentClaim ? 0.05 : 0),
      corrected || restricted ? 0.6 : 0,
    );
    let status: DimensionState["status"] = "unknown";
    if (dimension === "recognition" && exposures.length > 0) status = "exposed";
    if (effectiveEvidence > 0) status = "tentative";
    if (effectiveEvidence >= 1.2 && estimate >= 0.65 && !corrected && !restricted)
      status = "supported";
    if (lastObservedAt && Date.parse(input.now) - Date.parse(lastObservedAt) > 90 * 86400_000) {
      status = "stale";
    }
    return {
      estimate,
      uncertainty,
      status,
      effectiveEvidence,
      ...(lastObservedAt === undefined ? {} : { lastObservedAt }),
    };
  }

  return {
    knowledgeRevisionId: input.knowledgeRevisionId,
    dimensions: {
      recognition: dimensionState("recognition"),
      recall: dimensionState("recall"),
      explanation: dimensionState("explanation"),
      application: dimensionState("application"),
      discrimination: dimensionState("discrimination"),
      transfer: dimensionState("transfer"),
    },
    evidenceIds: relevant.map((item) => item.id),
    updatedAt: input.now,
    projectionVersion,
  };
}
