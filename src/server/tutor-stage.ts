import type { z } from "zod";
import type { ModelRunner } from "./model-runner.js";
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
  ) {}

  stage<T>(request: RunRequest<T>): Promise<StageResult<T>> {
    return this.runner
      .stage(
        this.input.owner,
        this.input.conversationId,
        this.input.messageId,
        request.stage,
        request.data,
        request.schema,
      )
      .then((result) => {
        this.runIds.push(result.runId);
        return result;
      });
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
