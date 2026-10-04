import { describe, expect, it, vi } from "vitest";
import { SearchResponseSchema } from "../../src/client/api-contract";
import { resolveKnowledgeSelection, sendDraft } from "../../src/client/app-state";
import type { KnowledgeItem } from "../../src/client/model";
import { createLatestRunner } from "../../src/client/useWorkspace";
import type { WorkspaceSnapshot } from "../../src/client/workspace";

function deferred<T>(): {
  readonly promise: Promise<T>;
  readonly resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (resolvePromise === undefined) throw new TypeError("Deferred promise was not initialized");
      resolvePromise(value);
    },
  };
}

const snapshot = (activeConversationId: string): WorkspaceSnapshot => ({
  conversations: [],
  activeConversationId,
  learningThreads: [],
  activeLearningThread: null,
  recovery: null,
  messages: [],
  knowledge: [],
  provider: {
    mode: "configured",
    label: "Test provider",
    guidance: "Available",
  },
});

describe("workspace correctness", () => {
  it("keeps the latest snapshot when an older request resolves last", async () => {
    const older = deferred<WorkspaceSnapshot>();
    const newer = deferred<WorkspaceSnapshot>();
    const applied: string[] = [];
    const run = createLatestRunner<WorkspaceSnapshot>({
      onStart: vi.fn(),
      onValue: (value) => applied.push(value.activeConversationId ?? "none"),
      onError: vi.fn(),
      onSettled: vi.fn(),
    });

    const olderRun = run(() => older.promise);
    const newerRun = run(() => newer.promise);
    newer.resolve(snapshot("newer"));
    await newerRun;
    older.resolve(snapshot("older"));
    await olderRun;

    expect(applied).toEqual(["newer"]);
  });

  it("refreshes persisted state after a failed send while preserving the error", async () => {
    const applied: string[] = [];
    const errors: string[] = [];
    const run = createLatestRunner<WorkspaceSnapshot>({
      onStart: vi.fn(),
      onValue: (value) => applied.push(value.activeConversationId ?? "none"),
      onError: (error) => errors.push(error.message),
      onSettled: vi.fn(),
    });

    const succeeded = await run(
      () => Promise.reject(new Error("Tutor generation is disabled")),
      () => Promise.resolve(snapshot("persisted-message-thread")),
    );

    expect(succeeded).toBe(false);
    expect(applied).toEqual(["persisted-message-thread"]);
    expect(errors).toEqual(["Tutor generation is disabled"]);
  });

  it("ignores an older recovery that resolves after a newer request", async () => {
    const recovery = deferred<WorkspaceSnapshot>();
    const applied: string[] = [];
    const run = createLatestRunner<WorkspaceSnapshot>({
      onStart: vi.fn(),
      onValue: (value) => applied.push(value.activeConversationId ?? "none"),
      onError: vi.fn(),
      onSettled: vi.fn(),
    });

    const olderRun = run(
      () => Promise.reject(new Error("Older request failed")),
      () => recovery.promise,
    );
    await Promise.resolve();
    await run(() => Promise.resolve(snapshot("newer")));
    recovery.resolve(snapshot("older-recovery"));
    await olderRun;

    expect(applied).toEqual(["newer"]);
  });

  it("derives selected knowledge from the latest snapshot", () => {
    const stale: KnowledgeItem = {
      id: "concept",
      name: "Old title",
      definition: "Old definition",
      revision: 1,
      sources: [],
      evidence: [],
      learnerState: [],
    };
    const refreshed: KnowledgeItem = { ...stale, definition: "Current definition", revision: 2 };

    expect(resolveKnowledgeSelection([refreshed], stale.id)).toEqual(refreshed);
    expect(resolveKnowledgeSelection([], stale.id)).toBeNull();
  });

  it("retains the draft when sending fails", async () => {
    const clear = vi.fn();

    await sendDraft("Keep this question", () => Promise.resolve(false), clear);

    expect(clear).not.toHaveBeenCalled();
  });

  it("accepts stable fields from the real search response", () => {
    const response = SearchResponseSchema.parse({
      results: [
        {
          id: "result-1",
          entityType: "knowledge",
          title: "Bayes theorem",
          statement: "Posterior probability updates prior probability.",
          scope: "private",
          revision: 2,
          score: 0.5,
          futureField: "preserved by the backend",
        },
      ],
      mode: "fts-only",
      degradedReason: "embedding_disabled",
    });

    expect(response.results[0]?.entityType).toBe("knowledge");
  });
});
