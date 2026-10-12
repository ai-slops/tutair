import type { TrackingStatus } from "./learning-model";

export const DIMENSIONS = [
  "Recognition",
  "Recall",
  "Explanation",
  "Application",
  "Discrimination",
  "Transfer",
] as const;
export type DimensionName = (typeof DIMENSIONS)[number];
export const DIMENSION_LABELS = {
  recognition: "Recognition",
  recall: "Recall",
  explanation: "Explanation",
  application: "Application",
  discrimination: "Discrimination",
  transfer: "Transfer",
} as const satisfies Record<string, DimensionName>;

export type Message = {
  readonly id: string;
  readonly role: "user" | "assistant";
  readonly content: string;
  readonly createdAt: string;
  readonly status: "complete" | "sending" | "failed";
  readonly tracking?: TrackingStatus;
  readonly generationRequestId?: string;
};

export type Evidence = {
  readonly id: string;
  readonly dimension: DimensionName | null;
  readonly summary: string;
  readonly source: string;
  readonly createdAt: string;
};

export type LearnerDimensionState = {
  readonly dimension: DimensionName;
  readonly estimate: number;
  readonly uncertainty: number;
  readonly status: "unknown" | "exposed" | "tentative" | "supported" | "stale";
  readonly effectiveEvidence: number;
  readonly projectionVersion: string;
  readonly knowledgeRevisionId: string;
  readonly evidenceIds: readonly string[];
};

export const REVIEW_STATUSES = ["unreviewed", "reviewed", "incorrect", "retired"] as const;
export type ReviewStatusName = (typeof REVIEW_STATUSES)[number];
export const REVIEW_ACTIONS = ["reviewed", "mark_incorrect", "retire", "restore"] as const;
export type ReviewAction = (typeof REVIEW_ACTIONS)[number];

export type KnowledgeReviewStatus = {
  readonly status: ReviewStatusName;
  readonly revision: number;
  readonly revisionId: string;
  readonly reason: string | null;
  readonly updatedAt: string | null;
};

export type KnowledgeRevision = {
  readonly id: string;
  readonly revision: number;
  readonly statement: string;
  readonly semanticScope: string;
  readonly sourceType: string;
  readonly sourceRef: string | null;
  readonly createdAt: string;
};

export type KnowledgeReviewEvent = {
  readonly id: string;
  readonly revision: number;
  readonly action: ReviewAction;
  readonly reason: string | null;
  readonly createdAt: string;
};

export type KnowledgeDocumentBlock = {
  readonly id: string;
  readonly type: string;
  readonly content: string;
  readonly contentHash: string;
  readonly sourceBlockId: string | null;
};

export type KnowledgeDocument = {
  readonly id: string;
  readonly role: "english_base" | "localization" | "legacy";
  readonly languageTag: string;
  readonly version: number;
  readonly sourceType: string;
  readonly sourceRefs: readonly string[];
  readonly createdAt: string;
  readonly stale: boolean;
  readonly blocks: readonly KnowledgeDocumentBlock[];
};

export type KnowledgeItem = {
  readonly id: string;
  readonly name: string;
  readonly definition: string;
  readonly revision: number;
  readonly scope: "canonical" | "provisional";
  readonly kind: string;
  readonly semanticScope: string;
  readonly sources: readonly string[];
  readonly evidence: readonly Evidence[];
  readonly learnerState: readonly LearnerDimensionState[];
  readonly reviewStatus: KnowledgeReviewStatus;
  readonly revisions: readonly KnowledgeRevision[];
  readonly reviewHistory: readonly KnowledgeReviewEvent[];
  readonly documents?: readonly KnowledgeDocument[];
};

export type MisconceptionItem = {
  readonly id: string;
  readonly revision: number;
  readonly revisionId: string;
  readonly label: string;
  readonly mistakenProposition: string;
  readonly correction: string;
  readonly failureTask: string;
  readonly likelyError: string;
  readonly discriminatingExample: {
    readonly scenario: string;
    readonly mistakenResponse: string;
    readonly correctedResponse: string;
    readonly decisiveCue: string;
  };
  readonly reuseValueReason: string;
  readonly definitionRevisionLinks: readonly {
    readonly definitionRevisionId: string;
    readonly role: "subject" | "contrast" | "correction_basis";
    readonly learningValue: string;
  }[];
  readonly reviewStatus: ReviewStatusName;
  readonly reviewHistory: readonly {
    readonly id: string;
    readonly action: ReviewAction;
    readonly reason: string | null;
    readonly createdAt: string;
  }[];
  readonly eligibilityReason: string | null;
  readonly createdAt: string;
};

export type ProviderStatus = {
  readonly mode: "configured" | "synthetic" | "unavailable";
  readonly label: string;
  readonly guidance: string;
};

export type ChatGptConnection = {
  readonly enabled: boolean;
  readonly connected: boolean;
  readonly manualCallback: boolean;
  readonly selectedModel: string | null;
  readonly models: readonly { readonly slug: string; readonly displayName: string }[];
};

export type CorrectionKind =
  | "revise"
  | "claim_more"
  | "claim_less"
  | "invalidate_evidence"
  | "meaning_mismatch";

export type SearchResult = {
  readonly id: string;
  readonly entityType: "knowledge" | "message" | "thread" | "evidence";
  readonly title: string;
  readonly statement: string;
  readonly score: number;
};
