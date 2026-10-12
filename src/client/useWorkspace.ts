import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GenerationTarget } from "./generation-contract";
import type {
  LearningThreadInput,
  LearningThreadStatus,
  QuestionStatus,
  RecoveryChoice,
} from "./learning-model";
import type { CorrectionKind, KnowledgeItem, ReviewAction, SearchResult } from "./model";
import type { DebugSettings } from "./provenance-contract";
import {
  EMPTY_SNAPSHOT,
  type SearchResponse,
  type WorkspaceApi,
  type WorkspaceSnapshot,
} from "./workspace";

type LatestRunnerHandlers<T> = {
  readonly onStart: () => void;
  readonly onValue: (value: T) => void;
  readonly onError: (error: Error) => void;
  readonly onSettled: () => void;
};

export function createLatestRunner<T>(handlers: LatestRunnerHandlers<T>) {
  let latestRequest = 0;
  return async (operation: () => Promise<T>, recover?: () => Promise<T>): Promise<boolean> => {
    const request = ++latestRequest;
    handlers.onStart();
    try {
      const value = await operation();
      if (request === latestRequest) handlers.onValue(value);
      return request === latestRequest;
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      if (request !== latestRequest) return false;
      if (recover !== undefined) {
        try {
          const recovered = await recover();
          if (request !== latestRequest) return false;
          handlers.onValue(recovered);
        } catch (recoveryCause) {
          if (!(recoveryCause instanceof Error)) throw recoveryCause;
        }
      }
      if (request !== latestRequest) return false;
      handlers.onError(cause);
      return false;
    } finally {
      if (request === latestRequest) handlers.onSettled();
    }
  };
}

type SearchState = {
  readonly results: readonly SearchResult[];
  readonly mode: SearchResponse["mode"] | null;
  readonly loading: boolean;
  readonly error: string | null;
};

type WorkspaceState = {
  readonly snapshot: WorkspaceSnapshot;
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly turnPending: boolean;
  readonly activeGeneration: GenerationTarget | null;
  readonly error: string | null;
  readonly refresh: () => Promise<boolean>;
  readonly createConversation: () => Promise<boolean>;
  readonly createLearningThread: (input: LearningThreadInput) => Promise<boolean>;
  readonly openConversation: (id: string) => Promise<boolean>;
  readonly openSearchThread: (id: string) => Promise<boolean>;
  readonly send: (content: string) => Promise<boolean>;
  readonly resolveTurn: (choice: RecoveryChoice) => Promise<boolean>;
  readonly retryTurn: () => Promise<boolean>;
  readonly updateLearningThread: (id: string, input: LearningThreadInput) => Promise<boolean>;
  readonly setThreadStatus: (id: string, status: LearningThreadStatus) => Promise<boolean>;
  readonly addQuestion: (id: string, text: string) => Promise<boolean>;
  readonly setQuestionStatus: (
    id: string,
    questionId: string,
    status: QuestionStatus,
  ) => Promise<boolean>;
  readonly promoteKnowledge: (id: string, knowledgeId: string) => Promise<boolean>;
  readonly createSession: () => Promise<boolean>;
  readonly correct: (
    item: KnowledgeItem,
    correction: string,
    kind: CorrectionKind,
  ) => Promise<boolean>;
  readonly review: (
    itemId: string,
    action: ReviewAction,
    reason: string,
    confirmed: boolean,
  ) => Promise<boolean>;
  readonly reviewMisconception: (
    itemId: string,
    action: ReviewAction,
    reason: string,
    confirmed: boolean,
  ) => Promise<boolean>;
  readonly deleteAll: () => Promise<boolean>;
  readonly selectChatGptModel: (slug: string) => Promise<boolean>;
  readonly beginChatGptManual: () => Promise<string | null>;
  readonly completeChatGptManual: (callbackUrl: string) => Promise<boolean>;
  readonly disconnectChatGpt: () => Promise<boolean>;
  readonly saveDebugSettings: (value: DebugSettings) => Promise<boolean>;
  readonly search: SearchState & { readonly run: (query: string) => Promise<void> };
};

export function useWorkspace(api: WorkspaceApi): WorkspaceState {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(EMPTY_SNAPSHOT);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(true);
  const [turnPending, setTurnPending] = useState(false);
  const [activeGeneration, setActiveGeneration] = useState<GenerationTarget | null>(null);
  const turnPendingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState<SearchState>({
    results: [],
    mode: null,
    loading: false,
    error: null,
  });
  const run = useMemo(
    () =>
      createLatestRunner<WorkspaceSnapshot>({
        onStart: () => {
          setLoading(true);
          setError(null);
        },
        onValue: setSnapshot,
        onError: (cause) => setError(cause.message),
        onSettled: () => {
          setLoading(false);
          setInitialized(true);
        },
      }),
    [],
  );
  const runSearch = useMemo(
    () =>
      createLatestRunner<SearchResponse>({
        onStart: () => setSearch((current) => ({ ...current, loading: true, error: null })),
        onValue: (response) =>
          setSearch({
            results: response.results,
            mode: response.mode,
            loading: false,
            error: null,
          }),
        onError: (cause) =>
          setSearch((current) => ({ ...current, loading: false, error: cause.message })),
        onSettled: () => setSearch((current) => ({ ...current, loading: false })),
      }),
    [],
  );
  const runTurn = useCallback(
    async (operation: () => Promise<WorkspaceSnapshot>): Promise<boolean> => {
      if (turnPendingRef.current) return false;
      turnPendingRef.current = true;
      setTurnPending(true);
      try {
        return await run(operation, () => api.load());
      } finally {
        turnPendingRef.current = false;
        setTurnPending(false);
        setActiveGeneration(null);
      }
    },
    [api, run],
  );

  const refresh = useCallback(() => run(() => api.load()), [api, run]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    snapshot,
    initialized,
    loading,
    turnPending,
    activeGeneration,
    error,
    refresh,
    createConversation: () => run(() => api.createConversation()),
    createLearningThread: (input) => run(() => api.createLearningThread(input)),
    openConversation: (id) => run(() => api.openConversation(id)),
    openSearchThread: (id) => run(() => api.openSearchThread(id)),
    send: (content) =>
      runTurn(() => api.sendMessage(snapshot.activeConversationId, content, setActiveGeneration)),
    resolveTurn: (choice) => runTurn(() => api.resolveTurn(choice, setActiveGeneration)),
    retryTurn: () => runTurn(() => api.retryTurn(setActiveGeneration)),
    updateLearningThread: (id, input) => run(() => api.updateLearningThread(id, input)),
    setThreadStatus: (id, status) => run(() => api.setThreadStatus(id, status)),
    addQuestion: (id, text) => run(() => api.addQuestion(id, text)),
    setQuestionStatus: (id, questionId, status) =>
      run(() => api.setQuestionStatus(id, questionId, status)),
    promoteKnowledge: (id, knowledgeId) => run(() => api.promoteKnowledge(id, knowledgeId)),
    createSession: () => run(() => api.createSession()),
    correct: (item, correction, kind) => run(() => api.correctKnowledge(item.id, correction, kind)),
    review: (itemId, action, reason, confirmed) => {
      const item = snapshot.knowledge.find((candidate) => candidate.id === itemId);
      return item === undefined
        ? Promise.resolve(false)
        : run(() => api.reviewKnowledge(itemId, item.revision, action, reason, confirmed));
    },
    reviewMisconception: (itemId, action, reason, confirmed) =>
      run(() => api.reviewMisconception(itemId, action, reason, confirmed)),
    deleteAll: () => run(() => api.deleteAll()),
    selectChatGptModel: (slug) => run(() => api.selectChatGptModel(slug)),
    beginChatGptManual: async () => {
      setLoading(true);
      setError(null);
      try {
        return await api.beginChatGptManual();
      } catch (cause) {
        if (!(cause instanceof Error)) throw cause;
        setError(cause.message);
        return null;
      } finally {
        setLoading(false);
      }
    },
    completeChatGptManual: (callbackUrl) => run(() => api.completeChatGptManual(callbackUrl)),
    disconnectChatGpt: () => run(() => api.disconnectChatGpt()),
    saveDebugSettings: async (value) => {
      const previous = snapshot.debugSettings;
      setSnapshot((current) => ({ ...current, debugSettings: value }));
      const succeeded = await run(() => api.saveDebugSettings(value));
      if (!succeeded) setSnapshot((current) => ({ ...current, debugSettings: previous }));
      return succeeded;
    },
    search: {
      ...search,
      async run(query) {
        const value = query.trim();
        if (value.length === 0) {
          setSearch({ results: [], mode: null, loading: false, error: null });
          return;
        }
        await runSearch(() => api.search(value));
      },
    },
  };
}
