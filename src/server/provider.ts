import type { Contracts } from "@slop-lab/part/reference/index.js";
import ky from "ky";
import { z } from "zod";
import { embedLocal, localEmbeddingProfile } from "./local-embeddings.js";
import { demoCall } from "./tutor-demo.js";
import type { ProviderState } from "./types.js";
import { ApiError } from "./types.js";

export const stages = [
  "extraction",
  "resolution",
  "planning",
  "preparation",
  "draft",
  "lint",
  "final",
  "evaluation",
] as const;
export type Stage = (typeof stages)[number];
export type StructuredCall = {
  readonly stage: Stage;
  readonly version: string;
  readonly system: string;
  readonly data: Readonly<Record<string, unknown>>;
  readonly jsonSchema: object;
  readonly reasoningSummaryEnabled?: boolean;
};
export type ProviderReasoningSummary =
  | { readonly state: "disabled" }
  | { readonly state: "unavailable" }
  | { readonly state: "available"; readonly text: string };
export type ProviderUsage = {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
};
export type ProviderRuntimeEvidence = {
  readonly operationId: string;
  readonly attemptId: string | null;
  readonly phase: string;
  readonly effect:
    | "not-applicable"
    | "not-attempted"
    | "not-applied"
    | "applied"
    | "partially-applied"
    | "unknown";
};
export type ProviderCallResult = {
  readonly value: unknown;
  readonly usage: ProviderUsage | null;
  readonly resolvedModel?: string;
  readonly reasoningSummary?: ProviderReasoningSummary;
  readonly runtime?: ProviderRuntimeEvidence;
};

export class ProviderCallError extends ApiError {
  constructor(
    error: ApiError,
    readonly runtime: ProviderRuntimeEvidence,
    readonly usage: ProviderUsage | null = null,
    readonly rawOutput?: string,
    readonly resolvedModel?: string,
  ) {
    super(error.status, error.code, error.message, error.details);
  }
}

export interface TutorProvider {
  readonly state: ProviderState;
  readonly embeddingProfile: string;
  call(
    call: StructuredCall,
    owner?: string,
    context?: Contracts.InvocationContext,
  ): Promise<unknown>;
  embed?(texts: readonly string[]): Promise<readonly (readonly number[])[]>;
}

const embeddingResponse = z.object({ data: z.array(z.object({ embedding: z.array(z.number()) })) });

export class RemoteEmbeddingProvider implements TutorProvider {
  readonly state;
  readonly client: typeof ky;
  readonly embeddingProfile: string;
  constructor(
    readonly generation: TutorProvider,
    readonly config: {
      readonly baseUrl: string;
      readonly apiKey: string;
      readonly embeddingModel: string;
    },
  ) {
    this.state = { ...generation.state, embedding: "configured" as const };
    this.embeddingProfile = `openai:${config.embeddingModel}:v1`;
    this.client = ky.create({
      prefixUrl: config.baseUrl.replace(/\/$/, ""),
      headers: { authorization: `Bearer ${config.apiKey}` },
      timeout: 30_000,
      retry: { limit: 2, methods: ["post"] },
    });
  }
  call(
    call: StructuredCall,
    owner?: string,
    context?: Contracts.InvocationContext,
  ): Promise<unknown> {
    return this.generation.call(call, owner, context);
  }
  async embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    const response: unknown = await this.client
      .post("embeddings", { json: { model: this.config.embeddingModel, input: texts } })
      .json();
    return embeddingResponse.parse(response).data.map((item) => item.embedding);
  }
}

export class DisabledProvider implements TutorProvider {
  readonly embeddingProfile = "disabled:v1";
  readonly state: ProviderState = {
    provider: "disabled",
    model: null,
    generation: false,
    synthetic: false,
    embedding: "disabled",
  };
  async call(_call?: StructuredCall, _owner?: string): Promise<never> {
    throw new ApiError(503, "provider_disabled", "Tutor generation is disabled");
  }
}

export class DemoProvider implements TutorProvider {
  readonly embeddingProfile = "disabled:v1";
  readonly state: ProviderState = {
    provider: "demo",
    model: "scripted-fsm-v1",
    generation: true,
    synthetic: true,
    embedding: "disabled",
  };
  async call(call: StructuredCall, _owner?: string): Promise<ProviderCallResult> {
    return { value: demoCall(call), usage: null };
  }
}

export class LocalEmbeddingProvider implements TutorProvider {
  readonly state: ProviderState;
  readonly embeddingProfile = localEmbeddingProfile;
  constructor(readonly generation: TutorProvider) {
    this.state = { ...generation.state, embedding: "configured" };
  }
  call(
    call: StructuredCall,
    owner?: string,
    context?: Contracts.InvocationContext,
  ): Promise<unknown> {
    return this.generation.call(call, owner, context);
  }
  embed(texts: readonly string[]): Promise<readonly (readonly number[])[]> {
    return embedLocal(texts);
  }
}

export { createProvider } from "./provider-factory.js";
