import { z } from "zod";
import type { ChatGptAuth } from "./chatgpt-auth.js";
import {
  DemoProvider,
  DisabledProvider,
  LocalEmbeddingProvider,
  OpenAiProvider,
  type TutorProvider,
} from "./provider.js";
import { ResponsesProvider } from "./responses-provider.js";
import { ApiError } from "./types.js";

export const createProvider = (
  env: NodeJS.ProcessEnv,
  chatgptAuth: ChatGptAuth | null = null,
): TutorProvider => {
  const kind = env["TUTOR_PROVIDER"] ?? "disabled";
  let provider: TutorProvider;
  if (kind === "demo") provider = new DemoProvider();
  else if (kind === "disabled") provider = new DisabledProvider();
  else if (kind === "chatgpt") provider = chatGptProvider(chatgptAuth);
  else provider = openAiProvider(kind, env);
  const embeddingProvider = env["EMBEDDING_PROVIDER"] ?? env["TUTOR_EMBEDDING_PROVIDER"] ?? "local";
  if (embeddingProvider === "local") return new LocalEmbeddingProvider(provider);
  if (embeddingProvider !== "openai" && embeddingProvider !== "disabled")
    throw new ApiError(
      500,
      "embedding_configuration",
      "EMBEDDING_PROVIDER must be local, openai, or disabled",
    );
  return provider;
};

function chatGptProvider(auth: ChatGptAuth | null): TutorProvider {
  if (auth === null)
    throw new ApiError(
      500,
      "provider_configuration",
      "ChatGPT provider requires TUTOR_CHATGPT_PERSONAL=true",
    );
  return new ResponsesProvider({
    stateProvider: "chatgpt",
    stateModel: null,
    resolve: (owner) => auth.responseCredential(owner),
  });
}

function openAiProvider(kind: string, env: NodeJS.ProcessEnv): TutorProvider {
  if (kind !== "openai")
    throw new ApiError(
      500,
      "invalid_provider",
      "TUTOR_PROVIDER must be demo, openai, chatgpt, or disabled",
    );
  const key = env["OPENAI_API_KEY"];
  const model = env["TUTOR_MODEL"];
  const baseUrl = env["OPENAI_BASE_URL"];
  if (key === undefined || model === undefined || baseUrl === undefined)
    throw new ApiError(
      500,
      "provider_configuration",
      "OpenAI provider requires OPENAI_API_KEY, OPENAI_BASE_URL, and TUTOR_MODEL",
    );
  const outputMode = z
    .enum(["strict", "compatibility", "responses"])
    .default("strict")
    .parse(env["TUTOR_OPENAI_MODE"]);
  if (outputMode === "responses")
    return new ResponsesProvider({
      stateProvider: "openai",
      stateModel: model,
      resolve: async () => ({ accessToken: key, model, apiBaseUrl: baseUrl }),
    });
  return new OpenAiProvider({
    model,
    baseUrl,
    apiKey: key,
    embeddingModel: env["TUTOR_EMBEDDING_MODEL"] ?? null,
    outputMode,
  });
}
