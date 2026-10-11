import type { Hono } from "hono";
import { z } from "zod";
import { AnswerProvenanceStore } from "./answer-provenance-store.js";
import { ownerFor, type Services } from "./context.js";
import { GenerationPipelineStore } from "./generation-pipeline-store.js";

const idSchema = z.uuid();

export function registerGenerationPipelineRoutes(app: Hono, services: Services): void {
  app.get("/conversations/:id/tutor-turns/:requestId/provenance", (c) => {
    const owner = ownerFor(c, services);
    const conversationId = idSchema.parse(c.req.param("id"));
    const requestId = idSchema.parse(c.req.param("requestId"));
    return c.json(new AnswerProvenanceStore(services.db).get({ owner, conversationId, requestId }));
  });
  app.get("/conversations/:id/tutor-turns/:requestId/pipeline", (c) => {
    const owner = ownerFor(c, services);
    const conversationId = idSchema.parse(c.req.param("id"));
    const requestId = idSchema.parse(c.req.param("requestId"));
    return c.json(
      new GenerationPipelineStore(services.db).summary({ owner, conversationId, requestId }),
    );
  });
  app.get("/conversations/:id/tutor-turns/:requestId/pipeline/:runId", (c) => {
    const owner = ownerFor(c, services);
    const conversationId = idSchema.parse(c.req.param("id"));
    const requestId = idSchema.parse(c.req.param("requestId"));
    const runId = idSchema.parse(c.req.param("runId"));
    return c.json(
      new GenerationPipelineStore(services.db).detail({ owner, conversationId, requestId }, runId),
    );
  });
}
