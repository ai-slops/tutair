import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { ZodError } from "zod";
import { Database } from "./database.js";
import { presentJson } from "./presentation.js";
import { createProvider, type TutorProvider } from "./provider.js";
import { CoreRepository } from "./repository-core.js";
import { KnowledgeRepository } from "./repository-knowledge.js";
import { coreRoutes } from "./routes-core.js";
import { exportRoutes } from "./routes-export.js";
import { knowledgeRoutes } from "./routes-knowledge.js";
import { qualityRoutes } from "./routes-quality.js";
import { TutorPipeline } from "./tutor.js";
import { ApiError } from "./types.js";

export type AppOptions = {
  readonly databasePath?: string;
  readonly provider?: TutorProvider;
  readonly env?: NodeJS.ProcessEnv;
};

export const createApp = (
  options: AppOptions = {},
): { readonly app: Hono; readonly database: Database } => {
  const database = new Database(options.databasePath ?? process.env["TUTOR_DB_PATH"] ?? "tutor.db");
  const provider = options.provider ?? createProvider(options.env ?? process.env);
  const core = new CoreRepository(database);
  const knowledge = new KnowledgeRepository(database);
  const configuredImportToken =
    options.env?.["TUTOR_CANONICAL_IMPORT_TOKEN"] ??
    process.env["TUTOR_CANONICAL_IMPORT_TOKEN"] ??
    "";
  const services = {
    db: database,
    provider,
    core,
    knowledge,
    tutor: new TutorPipeline(database, core, knowledge, provider),
    turnLocks: new Set<string>(),
    turnAttempts: new Map<string, number[]>(),
    canonicalImportToken: configuredImportToken.trim() === "" ? null : configuredImportToken,
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
    if (origin !== undefined && host !== undefined && new URL(origin).host !== host)
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
  app.route("/api", knowledgeRoutes(services));
  app.route("/api", qualityRoutes(services));
  app.route("/api", exportRoutes(services));
  app.get("/api/health", (c) => c.json({ status: "ok" }));
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
  return { app, database };
};
