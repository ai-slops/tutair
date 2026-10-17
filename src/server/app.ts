import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ZodError } from "zod";
import type { ChatGptAuth } from "./chatgpt-auth.js";
import { createChatGptAuth } from "./chatgpt-config.js";
import { Database } from "./database.js";
import { KnowledgeDocumentRepository } from "./knowledge-document-repository.js";
import { PartRuntime } from "./part-runtime.js";
import { presentJson } from "./presentation.js";
import type { TutorProvider } from "./provider.js";
import { createProvider } from "./provider-factory.js";
import { CoreRepository } from "./repository-core.js";
import { KnowledgeRepository } from "./repository-knowledge.js";
import { MisconceptionRepository } from "./repository-misconceptions.js";
import { chatGptRoutes } from "./routes-chatgpt.js";
import { coreRoutes } from "./routes-core.js";
import { exportRoutes } from "./routes-export.js";
import { knowledgeRoutes } from "./routes-knowledge.js";
import { qualityRoutes } from "./routes-quality.js";
import { TurnRequestStore } from "./turn-request-store.js";
import { TutorPipeline } from "./tutor.js";
import { ApiError } from "./types.js";

export type AppOptions = {
  readonly databasePath?: string;
  readonly provider?: TutorProvider;
  readonly env?: NodeJS.ProcessEnv;
  readonly chatgptAuth?: ChatGptAuth | null;
  readonly runtime?: PartRuntime;
  readonly runtimePath?: string | null;
};

export const createApp = (
  options: AppOptions = {},
): {
  readonly app: Hono;
  readonly database: Database;
  readonly runtime: PartRuntime;
  readonly ready: Promise<void>;
} => {
  const databasePath = options.databasePath ?? process.env["TUTOR_DB_PATH"] ?? "tutor.db";
  const database = new Database(databasePath);
  const runtime =
    options.runtime ??
    new PartRuntime(
      options.runtimePath === undefined
        ? databasePath === ":memory:"
          ? null
          : `${databasePath}.part-runtime.sqlite`
        : options.runtimePath,
    );
  const ready = runtime.ready.then(() => {
    new TurnRequestStore(database).reconcileUnsettled();
  });
  const chatgptAuth = options.chatgptAuth ?? createChatGptAuth(options.env ?? process.env);
  const provider =
    options.provider ?? createProvider(options.env ?? process.env, chatgptAuth, runtime);
  const core = new CoreRepository(database);
  const knowledge = new KnowledgeRepository(database);
  const documents = new KnowledgeDocumentRepository(database);
  const configuredImportToken =
    options.env?.["TUTOR_CANONICAL_IMPORT_TOKEN"] ??
    process.env["TUTOR_CANONICAL_IMPORT_TOKEN"] ??
    "";
  const services = {
    db: database,
    provider,
    core,
    knowledge,
    misconceptions: new MisconceptionRepository(database),
    documents,
    tutor: new TutorPipeline(database, core, knowledge, provider, runtime),
    runtime,
    ready,
    turnLocks: new Set<string>(),
    turnAttempts: new Map<string, number[]>(),
    canonicalImportToken: configuredImportToken.trim() === "" ? null : configuredImportToken,
    chatgptAuth,
  };
  const app = new Hono();
  app.use(
    "/api/*",
    bodyLimit({
      maxSize: 1_048_576,
      onError: (c) =>
        c.json({ error: { code: "body_too_large", message: "Request body exceeds 1 MiB" } }, 413),
    }),
  );
  app.use("/api/*", async (c, next) => {
    const origin = c.req.header("origin");
    const host = c.req.header("host");
    if (
      origin !== undefined &&
      host !== undefined &&
      (!URL.canParse(origin) || new URL(origin).host !== host)
    )
      throw new ApiError(401, "cross_origin_denied", "Cross-origin requests are not allowed");
    c.header("Cache-Control", "no-store");
    c.header("X-Content-Type-Options", "nosniff");
    await next();
    if (c.res.headers.get("content-type")?.includes("application/json") === true) {
      const payload: unknown = await c.res.clone().json();
      c.res = new Response(JSON.stringify(presentJson(payload)), {
        status: c.res.status,
        headers: c.res.headers,
      });
    }
  });
  app.route("/api", coreRoutes(services));
  app.route("/api", chatGptRoutes(services));
  app.route("/api", knowledgeRoutes(services));
  app.route("/api", qualityRoutes(services));
  app.route("/api", exportRoutes(services));
  app.get("/api/health", (c) => c.json({ status: "ok" }));
  app.get("/auth/callback", async (c) => {
    if (chatgptAuth === null)
      throw new ApiError(404, "chatgpt_personal_disabled", "Personal ChatGPT mode is disabled");
    await chatgptAuth.complete(new URL(c.req.url).searchParams);
    return c.html(
      '<!doctype html><html lang="en"><meta charset="utf-8"><title>ChatGPT connected</title><body><main><h1>ChatGPT connected</h1><p>Return to Tutair. You can close this tab.</p></main></body></html>',
    );
  });
  app.notFound((c) => c.json({ error: { code: "not_found", message: "Route not found" } }, 404));
  app.onError((error, c) => {
    if (error instanceof ApiError)
      return c.json(
        {
          error: {
            code: error.code,
            message: error.message,
            ...(error.details === undefined ? {} : { details: error.details }),
          },
        },
        error.status,
      );
    if (error instanceof ZodError)
      return c.json(
        {
          error: {
            code: "invalid_request",
            message: "Request validation failed",
            issues: error.issues,
          },
        },
        422,
      );
    console.error("Unhandled tutor API error", { name: error.name });
    return c.json({ error: { code: "internal_error", message: "Internal server error" } }, 500);
  });
  return { app, database, runtime, ready };
};
