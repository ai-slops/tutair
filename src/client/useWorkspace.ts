import { useCallback, useEffect, useMemo, useState } from "react";
import type { CorrectionKind, KnowledgeItem, SearchResult } from "./model";
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
  readonly loading: boolean;
  readonly error: string | null;
  readonly refresh: () => Promise<boolean>;
  readonly createThread: () => Promise<boolean>;
  readonly openConversation: (id: string) => Promise<boolean>;
  readonly openSearchThread: (id: string) => Promise<boolean>;
  readonly send: (content: string) => Promise<boolean>;
  readonly createSession: () => Promise<boolean>;
  readonly correct: (
    item: KnowledgeItem,
    correction: string,
    kind: CorrectionKind,
  ) => Promise<boolean>;
  readonly deleteAll: () => Promise<boolean>;
  readonly search: SearchState & { readonly run: (query: string) => Promise<void> };
};

export function useWorkspace(api: WorkspaceApi): WorkspaceState {
  const [snapshot, setSnapshot] = useState<WorkspaceSnapshot>(EMPTY_SNAPSHOT);
  const [loading, setLoading] = useState(true);
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
        onSettled: () => setLoading(false),
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

  const refresh = useCallback(() => run(() => api.load()), [api, run]);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return {
    snapshot,
    loading,
    error,
    refresh,
    createThread: () => run(() => api.createThread()),
    openConversation: (id) => run(() => api.openConversation(id)),
    openSearchThread: (id) => run(() => api.openSearchThread(id)),
    send: (content) =>
      run(
        () => api.sendMessage(snapshot.activeThreadId, content),
        () => api.load(),
      ),
    createSession: () => run(() => api.createSession()),
    correct: (item, correction, kind) => run(() => api.correctKnowledge(item.id, correction, kind)),
    deleteAll: () => run(() => api.deleteAll()),
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
