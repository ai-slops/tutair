import type {
  GenerationPipeline,
  GenerationRunDetail,
  GenerationTarget,
} from "./generation-contract";
import type {
  ConversationSummary,
  LearningThread,
  LearningThreadDetail,
  LearningThreadInput,
  LearningThreadStatus,
  QuestionStatus,
  RecoveryChoice,
  TurnRecovery,
} from "./learning-model";
import type {
  ChatGptConnection,
  CorrectionKind,
  KnowledgeItem,
  Message,
  ProviderStatus,
  ReviewAction,
  SearchResult,
} from "./model";
import type { AnswerProvenanceRecord, DebugSettings } from "./provenance-contract";

export type WorkspaceSnapshot = {
  readonly conversations: readonly ConversationSummary[];
  readonly activeConversationId: string | null;
  readonly learningThreads: readonly LearningThread[];
  readonly activeLearningThread: LearningThreadDetail | null;
  readonly recovery: TurnRecovery | null;
  readonly messages: readonly Message[];
  readonly knowledge: readonly KnowledgeItem[];
  readonly provider: ProviderStatus;
  readonly chatgpt: ChatGptConnection;
  readonly debugSettings: DebugSettings;
};

export interface WorkspaceApi {
  load(): Promise<WorkspaceSnapshot>;
  createConversation(): Promise<WorkspaceSnapshot>;
  createLearningThread(input: LearningThreadInput): Promise<WorkspaceSnapshot>;
  openConversation(conversationId: string): Promise<WorkspaceSnapshot>;
  openSearchThread(threadId: string): Promise<WorkspaceSnapshot>;
  sendMessage(
    conversationId: string | null,
    content: string,
    onStarted?: (target: GenerationTarget) => void,
  ): Promise<WorkspaceSnapshot>;
  resolveTurn(
    choice: RecoveryChoice,
    onStarted?: (target: GenerationTarget) => void,
  ): Promise<WorkspaceSnapshot>;
  retryTurn(onStarted?: (target: GenerationTarget) => void): Promise<WorkspaceSnapshot>;
  updateLearningThread(threadId: string, input: LearningThreadInput): Promise<WorkspaceSnapshot>;
  setThreadStatus(threadId: string, status: LearningThreadStatus): Promise<WorkspaceSnapshot>;
  addQuestion(threadId: string, text: string): Promise<WorkspaceSnapshot>;
  setQuestionStatus(
    threadId: string,
    questionId: string,
    status: QuestionStatus,
  ): Promise<WorkspaceSnapshot>;
  promoteKnowledge(threadId: string, knowledgeId: string): Promise<WorkspaceSnapshot>;
  createSession(): Promise<WorkspaceSnapshot>;
  correctKnowledge(
    itemId: string,
    correction: string,
    kind: CorrectionKind,
  ): Promise<WorkspaceSnapshot>;
  reviewKnowledge(
    itemId: string,
    revision: number,
    action: ReviewAction,
    reason: string,
    confirmed: boolean,
  ): Promise<WorkspaceSnapshot>;
  deleteAll(): Promise<WorkspaceSnapshot>;
  selectChatGptModel(slug: string): Promise<WorkspaceSnapshot>;
  beginChatGptManual(): Promise<string>;
  completeChatGptManual(callbackUrl: string): Promise<WorkspaceSnapshot>;
  disconnectChatGpt(): Promise<WorkspaceSnapshot>;
  saveDebugSettings(value: DebugSettings): Promise<WorkspaceSnapshot>;
  answerProvenance(target: GenerationTarget): Promise<AnswerProvenanceRecord>;
  search(query: string): Promise<SearchResponse>;
  generationPipeline(target: GenerationTarget, signal: AbortSignal): Promise<GenerationPipeline>;
  generationRun(
    target: GenerationTarget,
    runId: string,
    signal: AbortSignal,
  ): Promise<GenerationRunDetail>;
  exportUrl(): string;
}

export type SearchResponse = {
  readonly results: readonly SearchResult[];
  readonly mode: "hybrid" | "fts-only";
  readonly degradedReason?: string | undefined;
};

export const EMPTY_PROVIDER: ProviderStatus = {
  mode: "unavailable",
  label: "Model unavailable",
  guidance:
    "Create a local session, then ask the server administrator to configure the model provider.",
};

export const EMPTY_SNAPSHOT: WorkspaceSnapshot = {
  conversations: [],
  activeConversationId: null,
  learningThreads: [],
  activeLearningThread: null,
  recovery: null,
  messages: [],
  knowledge: [],
  provider: EMPTY_PROVIDER,
  chatgpt: {
    enabled: false,
    connected: false,
    manualCallback: false,
    selectedModel: null,
    models: [],
  },
  debugSettings: { saveProviderReasoningSummaries: false },
};
