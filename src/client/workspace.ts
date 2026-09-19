import type {
  CorrectionKind,
  KnowledgeItem,
  Message,
  ProviderStatus,
  SearchResult,
  Thread,
} from "./model";

export type WorkspaceSnapshot = {
  readonly threads: readonly Thread[];
  readonly activeThreadId: string | null;
  readonly messages: readonly Message[];
  readonly knowledge: readonly KnowledgeItem[];
  readonly provider: ProviderStatus;
};

export interface WorkspaceApi {
  load(): Promise<WorkspaceSnapshot>;
  createThread(): Promise<WorkspaceSnapshot>;
  openConversation(conversationId: string): Promise<WorkspaceSnapshot>;
  openSearchThread(threadId: string): Promise<WorkspaceSnapshot>;
  sendMessage(threadId: string | null, content: string): Promise<WorkspaceSnapshot>;
  createSession(): Promise<WorkspaceSnapshot>;
  correctKnowledge(
    itemId: string,
    correction: string,
    kind: CorrectionKind,
  ): Promise<WorkspaceSnapshot>;
  deleteAll(): Promise<WorkspaceSnapshot>;
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
  threads: [],
  activeThreadId: null,
  messages: [],
  knowledge: [],
  provider: EMPTY_PROVIDER,
};
