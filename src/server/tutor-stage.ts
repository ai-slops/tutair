import { localContext } from "@slop-lab/part";
import type { Contracts } from "@slop-lab/part/reference/index.js";
import type { z } from "zod";
import { type ModelRunner, StructuredOutputError } from "./model-runner.js";
import type { TurnInput } from "./tutor-schemas.js";

export type StageResult<T> = { readonly runId: string; readonly value: T };
type RunRequest<T> = {
  readonly stage: Parameters<ModelRunner["stage"]>[3];
  readonly data: Readonly<Record<string, unknown>>;
  readonly schema: z.ZodType<T>;
};
type FallbackRequest<T> = RunRequest<T> & { readonly fallback: T };

export class TutorStageRunner {
  readonly runIds: string[] = [];
  constructor(
    readonly runner: ModelRunner,
    readonly input: TurnInput,
    readonly runtimeContext: Contracts.InvocationContext = localContext(),
  ) {}

  async stage<T>(request: RunRequest<T>): Promise<StageResult<T>> {
    const run = (data: Readonly<Record<string, unknown>>) =>
      this.runner.stage(
        this.input.owner,
        this.input.conversationId,
        this.input.messageId,
        request.stage,
        data,
        request.schema,
        this.runtimeContext,
      );
    let result: StageResult<T>;
    try {
      result = await run(request.data);
    } catch (error) {
      if (!(error instanceof StructuredOutputError)) throw error;
      result = await run({
        ...request.data,
        repairOfRunId: error.runId,
        outputCorrection: { previousOutput: error.output, issues: error.issues },
      });
    }
    this.runIds.push(result.runId);
    return result;
  }

  async withFallback<T>(request: FallbackRequest<T>): Promise<StageResult<T>> {
    try {
      return await this.stage(request);
    } catch (error) {
      if (!(error instanceof Error)) throw error;
      this.runner.markFallback(this.input.owner, this.input.messageId, request.stage);
      return { runId: "fallback", value: request.fallback };
    }
  }
}
