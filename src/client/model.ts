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

export type KnowledgeItem = {
  readonly id: string;
  readonly name: string;
  readonly definition: string;
  readonly revision: number;
  readonly sources: readonly string[];
  readonly evidence: readonly Evidence[];
  readonly learnerState: readonly LearnerDimensionState[];
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
