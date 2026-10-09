import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { ChatGptAuth } from "./chatgpt-auth.js";
import { ProtectedTokenStore } from "./chatgpt-token-store.js";

export function createChatGptAuth(env: NodeJS.ProcessEnv): ChatGptAuth | null {
  if (env["TUTOR_CHATGPT_PERSONAL"] !== "true") return null;
  return new ChatGptAuth({
    enabled: true,
    callbackPort: z.coerce
      .number()
      .int()
      .min(1)
      .max(65_535)
      .default(1455)
      .parse(env["TUTOR_CHATGPT_CALLBACK_PORT"]),
    authorizationUrl:
      env["TUTOR_CHATGPT_AUTHORIZATION_URL"] ?? "https://auth.openai.com/api/accounts/authorize",
    tokenUrl: env["TUTOR_CHATGPT_TOKEN_URL"] ?? "https://auth.openai.com/api/accounts/oauth/token",
    jwksUrl: env["TUTOR_CHATGPT_JWKS_URL"] ?? "https://auth.openai.com/.well-known/jwks.json",
    issuer: env["TUTOR_CHATGPT_ISSUER"] ?? "https://auth.openai.com",
    apiBaseUrl: env["TUTOR_CHATGPT_API_URL"] ?? "https://api.openai.com/v1",
    store: new ProtectedTokenStore(
      env["TUTOR_CHATGPT_STORE"] ?? join(homedir(), ".config", "tutair", "chatgpt.json"),
    ),
  });
}
