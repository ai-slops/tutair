export type ThreadOrigin =
  | "question"
  | "project"
  | "problem"
  | "resource"
  | "curriculum"
  | "recommendation";

export type LearningThreadStatus = "open" | "paused" | "resolved" | "abandoned";
export type QuestionStatus = "open" | "parked" | "resolved";

export type ConversationSummary = {
  readonly id: string;
  readonly title: string;
  readonly updatedAt: string;
};

export type LearningThread = {
  readonly id: string;
  readonly conversationId: string | null;
  readonly title: string;
  readonly goal: string;
  readonly origin: ThreadOrigin;
  readonly whyNow: string | null;
  readonly desiredOutcome: string;
  readonly status: LearningThreadStatus;
  readonly targetKnowledgeUnitIds: readonly string[];
  readonly deferredKnowledgeUnitIds: readonly string[];
  readonly updatedAt: string;
};

export type LearningQuestion = {
  readonly id: string;
  readonly question: string;
  readonly status: QuestionStatus;
};

export type LearningThreadDetail = LearningThread & {
  readonly questions: readonly LearningQuestion[];
};

export type LearningThreadInput = {
  readonly title: string;
  readonly desiredOutcome: string;
  readonly origin: ThreadOrigin;
  readonly whyNow: string;
};

export type TrackingStatus = {
  readonly evaluationSkipped: boolean;
  readonly extractionFallback: boolean;
  readonly lintSkipped: boolean;
  readonly exposureTrackingSkipped: boolean;
  readonly followupTrackingSkipped: boolean;
};

export type TurnRecovery = {
  readonly requestId: string;
  readonly conversationId: string;
  readonly userMessageId: string | null;
  readonly content: string;
  readonly kind: "selection" | "running" | "failed" | "unknown";
  readonly candidateThreadIds: readonly string[];
  readonly message: string;
};

export type RecoveryChoice = { readonly threadId: string } | { readonly newThread: true };
