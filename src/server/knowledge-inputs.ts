import type { DefinitionScope, EvidenceEvaluator } from "./knowledge-contracts.js";
import type { ReviewAction } from "./knowledge-review.js";
import type { KnowledgeDimension } from "./learner-projection.js";
import type { RiskScope } from "./types.js";

export const evidenceTypes = [
  "self_report",
  "recognition_response",
  "free_explanation",
  "application",
  "contrast",
  "prediction",
  "artifact",
  "execution_result",
] as const;
export type EvidenceType = (typeof evidenceTypes)[number];

export type RevisionClaim = {
  readonly text: string;
  readonly authority: "canonical" | "provisional" | "learner" | "external";
  readonly sourceRefs: readonly string[];
  readonly status?: "model_generated" | "source_supported" | "reviewed" | undefined;
};

export type NewKnowledge = {
  readonly title: string;
  readonly statement: string;
  readonly riskScope: RiskScope;
  readonly confidence: number;
  readonly kind?:
    | "term_sense"
    | "concept"
    | "claim"
    | "procedure"
    | "skill"
    | "distinction"
    | "misconception";
  readonly aliases?: readonly string[];
  readonly semanticScope?: string;
  readonly definitionScope?: DefinitionScope;
  readonly distinguishingFeatures?: readonly string[];
  readonly claims?: readonly (string | RevisionClaim)[];
  readonly sourceRefs?: readonly string[];
  readonly canonicalKey?: string;
  readonly sourceRef?: string;
  readonly sourceType?: "learner_manual" | "model_generated";
  readonly modelRunId?: string;
  readonly conversationId?: string;
  readonly sourceMessageIds?: readonly string[];
  readonly sourceMessageEventIds?: readonly string[];
};

export type NewEvidence = {
  readonly knowledgeId: string;
  readonly knowledgeRevisionId: string;
  readonly revision: number;
  readonly conversationId: string;
  readonly messageId: string;
  readonly messageEventId?: string;
  readonly assessmentId?: string;
  readonly dimension: KnowledgeDimension;
  readonly evidenceType: EvidenceType;
  readonly score: number;
  readonly polarity: "positive" | "negative" | "ambiguous";
  readonly strength: number;
  readonly evaluatorConfidence: number;
  readonly evaluator: EvidenceEvaluator;
  readonly assistance: {
    readonly hints: number;
    readonly answerVisible: boolean;
    readonly openBook: boolean;
    readonly copiedFromRecentContext: boolean;
  };
  readonly supportingSpans: readonly { readonly start: number; readonly end: number }[];
  readonly limitations: readonly string[];
  readonly relatedUnitIds: readonly string[];
  readonly threadId?: string;
  readonly difficulty?: number;
  readonly contextDiscount?: number;
};

export type NewRevision = {
  readonly knowledgeId: string;
  readonly statement: string;
  readonly sourceType: string;
  readonly sourceRef: string | null;
  readonly details?: NewKnowledge;
};

export type CorrectionInput = {
  readonly knowledgeId: string;
  readonly revision: number;
  readonly statement: string;
  readonly reason: string;
  readonly messageId?: string;
  readonly kind:
    | "revise"
    | "claim_more"
    | "claim_less"
    | "invalidate_evidence"
    | "meaning_mismatch";
  readonly evidenceIds: readonly string[];
  readonly targetType: "knowledge" | "revision" | "evidence" | "meaning";
  readonly targetId?: string;
};

export type KnowledgeReviewInput = {
  readonly knowledgeId: string;
  readonly revision: number;
  readonly action: ReviewAction;
  readonly reason: string | null;
  readonly confirmed: boolean;
};
