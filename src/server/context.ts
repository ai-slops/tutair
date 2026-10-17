import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import type { ChatGptAuth } from "./chatgpt-auth.js";
import type { Database } from "./database.js";
import type { KnowledgeDocumentRepository } from "./knowledge-document-repository.js";
import type { PartRuntime } from "./part-runtime.js";
import type { TutorProvider } from "./provider.js";
import type { CoreRepository } from "./repository-core.js";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import type { MisconceptionRepository } from "./repository-misconceptions.js";
import type { TutorPipeline } from "./tutor.js";
import type { LearnerId } from "./types.js";
import { ApiError } from "./types.js";

export type Services = {
  readonly db: Database;
  readonly core: CoreRepository;
  readonly knowledge: KnowledgeRepository;
  readonly misconceptions: MisconceptionRepository;
  readonly documents: KnowledgeDocumentRepository;
  readonly provider: TutorProvider;
  readonly tutor: TutorPipeline;
  readonly runtime?: PartRuntime;
  readonly ready?: Promise<void>;
  readonly turnLocks: Set<string>;
  readonly turnAttempts: Map<string, number[]>;
  readonly canonicalImportToken?: string | null;
  readonly chatgptAuth?: ChatGptAuth | null;
};

export const ownerFor = (c: Context, services: Services): LearnerId => {
  const token = getCookie(c, "tutor_session");
  if (token === undefined)
    throw new ApiError(401, "authentication_required", "Sign in locally first");
  const owner = services.core.authenticate(token);
  if (owner === null) throw new ApiError(401, "invalid_session", "Session is invalid or expired");
  return owner;
};

export const jsonBody = async (c: Context): Promise<unknown> => {
  try {
    return await c.req.json<unknown>();
  } catch (error) {
    if (error instanceof SyntaxError)
      throw new ApiError(400, "invalid_json", "Request body must be valid JSON");
    throw error;
  }
};
