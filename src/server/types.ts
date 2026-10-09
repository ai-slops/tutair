export type Brand<T, Name extends string> = T & { readonly __brand: Name };
export type LearnerId = string;
export type ConversationId = string;
export type MessageId = string;

export const riskScopes = [
  "stable",
  "definition-sensitive",
  "current-contested",
  "high-stakes",
] as const;
export type RiskScope = (typeof riskScopes)[number];

export type AuthContext = {
  readonly learnerId: LearnerId;
  readonly sessionId: string;
};

export type ProviderState = {
  readonly outputMode?: "strict" | "compatibility" | "responses";
  readonly provider: "demo" | "openai" | "chatgpt" | "disabled";
  readonly model: string | null;
  readonly generation: boolean;
  readonly synthetic: boolean;
  readonly embedding: "configured" | "disabled";
};

export class ApiError extends Error {
  readonly name = "ApiError";
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503,
    readonly code: string,
    message: string,
    readonly details?: Readonly<Record<string, string>>,
  ) {
    super(message);
  }
}

export const isoNow = (): string => new Date().toISOString();
export const newId = (): string => crypto.randomUUID();
