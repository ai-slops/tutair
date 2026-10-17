import { chmodSync } from "node:fs";
import { createOperations, localContext } from "@slop-lab/part";
import type { Contracts, Runtime, Storage } from "@slop-lab/part/reference/index.js";
import type { OperationContext, Operations } from "@slop-lab/part/runtime/operations.js";
import { createMemoryStore, type LocalStore } from "@slop-lab/part/storage/memory.js";
import { createExecutionRecovery, createStoredBoundary } from "@slop-lab/part/storage/runtime.js";
import { openSqliteStore } from "@slop-lab/part-node/storage/sqlite.js";

type OperationResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: unknown };

type TurnRequest<T> = {
  readonly owner: string;
  readonly requestId: string;
  readonly deadlineMs: number;
  readonly onStarted?: (operationId: string) => void;
  readonly body: (context: OperationContext) => Promise<T>;
};

type StageRequest<T> = {
  readonly parent: Contracts.InvocationContext;
  readonly kind: string;
  readonly onStarted?: (operationId: string) => void;
  readonly body: (context: OperationContext) => Promise<T>;
};

export type PartRecoveryReport = Storage.RecoveryReport;

export class PartOperationError extends Error {
  readonly name = "PartOperationError";
  constructor(readonly failure: Contracts.Failure) {
    super(failure.message);
  }
}

export class PartRuntime {
  readonly operations: Operations;
  readonly boundary: Runtime.InvocationBoundary;
  readonly ready: Promise<PartRecoveryReport>;
  private readonly store: LocalStore;
  private readonly active = new Map<string, Runtime.ExecutionHandle<unknown>>();

  constructor(sidecarPath: string | null) {
    this.operations = createOperations({ cancellationGraceMs: 1_000 });
    if (sidecarPath === null) this.store = createMemoryStore();
    else {
      const opened = openSqliteStore(sidecarPath, "tutair/part-runtime");
      if (!opened.ok) throw new PartOperationError(opened.error);
      this.store = opened.value;
      chmodSync(sidecarPath, 0o600);
    }
    this.boundary = createStoredBoundary(this.store, "tutair/provider-effects");
    this.ready = this.recover();
  }

  async turn<T>(
    request: TurnRequest<T>,
  ): Promise<{ readonly operationId: string; readonly value: T }> {
    await this.ready;
    const controller = new AbortController();
    const context = localContext({
      principal: { subject: request.owner, authority: "tutair/learner" },
      scope: { kind: "runtime", id: request.requestId },
      signal: controller.signal,
      deadline: new Date(Date.now() + request.deadlineMs).toISOString(),
      correlationId: request.requestId,
      idempotencyKey: request.requestId,
    });
    return this.execute(
      this.operations,
      { kind: "tutair/turn", retryOwner: "tutair/runtime", childPolicy: "attached" },
      context,
      request.body,
      request.onStarted,
    );
  }

  async stage<T>(request: StageRequest<T>): Promise<T> {
    const completed = await this.execute(
      this.operations,
      { kind: request.kind, retryOwner: "tutair/runtime", childPolicy: "attached" },
      request.parent,
      request.body,
      request.onStarted,
    );
    return completed.value;
  }

  async dispose(): Promise<void> {
    const handles = [...this.active.values()];
    await Promise.all(handles.map((handle) => handle.requestCancel("server-shutdown")));
    await Promise.all(handles.map((handle) => handle.done));
    this.store.close();
  }

  async recordUnsettledFixture(): Promise<void> {
    const context = localContext();
    const prepared = await this.boundary.prepare(
      {
        operationId: crypto.randomUUID(),
        attemptId: crypto.randomUUID(),
        target: "fixture/provider",
        executor: "fixture/transport",
        inputDigest: "fixture-input",
        scopeDigest: "fixture-scope",
        compositionRevision: "fixture-v1",
        classification: "external",
      },
      context,
    );
    if (!prepared.ok) throw new PartOperationError(prepared.error);
  }

  private async recover(): Promise<PartRecoveryReport> {
    const recovered = await createExecutionRecovery(this.store).recover(localContext());
    if (!recovered.ok) throw new PartOperationError(recovered.error);
    return recovered.value;
  }

  private async execute<T>(
    operations: Operations,
    spec: Runtime.OperationSpec,
    context: Contracts.InvocationContext,
    body: (context: OperationContext) => Promise<T>,
    onStarted?: (operationId: string) => void,
  ): Promise<{ readonly operationId: string; readonly value: T }> {
    const started = await operations.begin<OperationResult<T>>(
      spec,
      async (operationContext) => {
        try {
          return {
            phase: "completed",
            result: { ok: true, value: await body(operationContext) },
            effect: "applied",
            unsettledChildren: [],
            commit: [],
          };
        } catch (error) {
          return {
            phase: "completed",
            result: { ok: false, error },
            effect: "unknown",
            unsettledChildren: [],
            commit: [],
          };
        }
      },
      context,
    );
    if (!started.ok) throw new PartOperationError(started.error);
    const handle = started.value;
    this.active.set(handle.ref.id, handle);
    onStarted?.(handle.ref.id);
    try {
      const outcome = await handle.done;
      if (outcome.phase !== "completed") {
        if ("error" in outcome && outcome.error !== undefined)
          throw new PartOperationError(outcome.error);
        throw new PartOperationError({
          code: "tutair.operation.cancelled",
          category: "cancelled",
          message: "Operation was cancelled",
          retry: "after-reconciliation",
        });
      }
      if (!outcome.result.ok) throw outcome.result.error;
      return { operationId: handle.ref.id, value: outcome.result.value };
    } finally {
      this.active.delete(handle.ref.id);
    }
  }
}
