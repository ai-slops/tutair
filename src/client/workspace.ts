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
  SearchResult,
} from "./model";

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
};

export interface WorkspaceApi {
  load(): Promise<WorkspaceSnapshot>;
  createConversation(): Promise<WorkspaceSnapshot>;
  createLearningThread(input: LearningThreadInput): Promise<WorkspaceSnapshot>;
  openConversation(conversationId: string): Promise<WorkspaceSnapshot>;
  openSearchThread(threadId: string): Promise<WorkspaceSnapshot>;
  sendMessage(conversationId: string | null, content: string): Promise<WorkspaceSnapshot>;
  resolveTurn(choice: RecoveryChoice): Promise<WorkspaceSnapshot>;
  retryTurn(): Promise<WorkspaceSnapshot>;
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
  deleteAll(): Promise<WorkspaceSnapshot>;
  selectChatGptModel(slug: string): Promise<WorkspaceSnapshot>;
  completeChatGptManual(callbackUrl: string): Promise<WorkspaceSnapshot>;
  disconnectChatGpt(): Promise<WorkspaceSnapshot>;
  search(query: string): Promise<SearchResponse>;
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
};
