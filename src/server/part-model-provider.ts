import { localContext } from "@slop-lab/part";
import { bearerAuth, createModelGateway } from "@slop-lab/part/model/index.js";
import type { Contracts } from "@slop-lab/part/reference/index.js";
import { createOpenAICompatibleAdapter } from "@slop-lab/part-plugins/providers/openai-compatible/index.js";
import { createOpenAIResponsesAdapter } from "@slop-lab/part-plugins/providers/openai-responses/index.js";
import {
  compilePartContext,
  createPartProfile,
  type PartOutputMode,
  parseProviderValue,
  providerReasoningSummary,
  responseText,
  toProviderApiError,
} from "./part-model-mapping.js";
import { tutorRequestTransform } from "./part-request-transform.js";
import type { PartRuntime } from "./part-runtime.js";
import { createTutorTransport } from "./part-transport.js";
import {
  ProviderCallError,
  type ProviderCallResult,
  type ProviderRuntimeEvidence,
  type ProviderUsage,
  type StructuredCall,
  type TutorProvider,
} from "./provider.js";
import { ApiError } from "./types.js";

export type PartCredential = {
  readonly accessToken: string;
  readonly model: string;
  readonly apiBaseUrl: string;
};

type PartProviderOptions = {
  readonly runtime: PartRuntime;
  readonly stateProvider: "chatgpt" | "openai";
  readonly stateModel: string | null;
  readonly outputMode: PartOutputMode;
  readonly requestTimeoutMs?: number;
  readonly resolve: (owner: string) => Promise<PartCredential>;
};

export class PartModelProvider implements TutorProvider {
  readonly embeddingProfile = "disabled:v1";
  readonly state;

  constructor(private readonly options: PartProviderOptions) {
    this.state = {
      provider: options.stateProvider,
      model: options.stateModel,
      generation: true,
      synthetic: false,
      embedding: "disabled" as const,
      outputMode: options.outputMode,
    };
  }

  async call(
    call: StructuredCall,
    owner = "local",
    parentContext?: Contracts.InvocationContext,
  ): Promise<ProviderCallResult> {
    const credential = await this.options.resolve(owner);
    const endpoint = `${credential.apiBaseUrl.replace(/\/$/, "")}/${
      this.options.outputMode === "responses" ? "responses" : "chat/completions"
    }`;
    let attemptId: string | undefined;
    const profile = createPartProfile(call, credential.model, endpoint, this.options.outputMode);
    const gateway = createModelGateway({
      profiles: [profile],
      adapters: [
        this.options.outputMode === "responses"
          ? createOpenAIResponsesAdapter()
          : createOpenAICompatibleAdapter(),
      ],
      transports: [createTutorTransport([new URL(endpoint).origin])],
      auth: { tutor: bearerAuth(() => credential.accessToken) },
      operations: this.options.runtime.operations,
      boundary: this.options.runtime.boundary,
      transforms: [tutorRequestTransform(this.options.outputMode)],
      inspect: (inspection) => {
        attemptId = inspection.attemptId;
      },
    });
    if (!gateway.ok) throw toProviderApiError(gateway.error);
    const context =
      parentContext ??
      localContext({
        principal: { subject: owner, authority: "tutair/learner" },
        deadline: new Date(Date.now() + (this.options.requestTimeoutMs ?? 300_000)).toISOString(),
      });
    const compiled = await compilePartContext(
      call,
      context,
      profile.capabilities,
      this.options.outputMode,
    );
    const invoked = await gateway.value.invoke(
      { profileId: profile.id, context: compiled, tools: [], options: profile.defaults },
      context,
    );
    if (!invoked.ok) throw toProviderApiError(invoked.error);
    const operationId = invoked.value.ref.id;
    const outcome = await invoked.value.done;
    const runtime = {
      operationId,
      attemptId: attemptId ?? null,
      phase: outcome.phase,
      effect: outcome.effect,
    } satisfies ProviderRuntimeEvidence;
    if (outcome.phase !== "completed") {
      if (context.deadline !== undefined && Date.parse(context.deadline) <= Date.now())
        throw new ProviderCallError(
          new ApiError(503, "provider_timeout", "Provider request timed out"),
          runtime,
          null,
          undefined,
          credential.model,
        );
      if ("error" in outcome && outcome.error !== undefined)
        throw new ProviderCallError(
          toProviderApiError(outcome.error),
          runtime,
          null,
          undefined,
          credential.model,
        );
      throw new ProviderCallError(
        new ApiError(503, "provider_cancelled", "Provider request was cancelled"),
        runtime,
        null,
        undefined,
        credential.model,
      );
    }
    const response = outcome.result;
    const usage = providerUsage(response.usage.inputTokens, response.usage.outputTokens);
    const rawOutput = responseText(response);
    if (["length", "content_filter"].includes(response.finish.normalized))
      throw new ProviderCallError(
        new ApiError(502, "provider_truncated_output", "Provider did not finish normally"),
        runtime,
        usage,
        rawOutput,
        credential.model,
      );
    let value: unknown;
    try {
      value = parseProviderValue(rawOutput, this.options.outputMode === "compatibility");
    } catch (error) {
      if (error instanceof ApiError)
        throw new ProviderCallError(error, runtime, usage, rawOutput, credential.model);
      throw error;
    }
    return {
      value,
      usage,
      resolvedModel: credential.model,
      ...(this.options.outputMode === "responses"
        ? {
            reasoningSummary: providerReasoningSummary(
              response,
              call.reasoningSummaryEnabled === true,
            ),
          }
        : {}),
      runtime,
    };
  }
}

const providerUsage = (
  inputTokens: number | undefined,
  outputTokens: number | undefined,
): ProviderUsage | null =>
  inputTokens === undefined || outputTokens === undefined
    ? null
    : { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens };
