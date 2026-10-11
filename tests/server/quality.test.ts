import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { Database } from "../../src/server/database.js";
import { KnowledgeDocumentRepository } from "../../src/server/knowledge-document-repository.js";
import { createProvider } from "../../src/server/provider.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import { KnowledgeRepository } from "../../src/server/repository-knowledge.js";
import { qualityRoutes, summarizeQuality } from "../../src/server/routes-quality.js";
import { TutorPipeline } from "../../src/server/tutor.js";
import { ApiError } from "../../src/server/types.js";

describe("quality measurements", () => {
  it("reports unavailable rates rather than perfect scores with no observations", () => {
    const result = summarizeQuality([]);
    expect(result.metrics.every((metric) => metric.samples === 0 && metric.mean === null)).toBe(
      true,
    );
    expect(result.calibrationBrierScore).toBeNull();
  });

  it("computes measured extraction precision from labeled samples", () => {
    const result = summarizeQuality([
      { metric: "extraction_correct", value: 1, prediction: null },
      { metric: "extraction_correct", value: 0, prediction: null },
    ]);
    expect(result.metrics.find((metric) => metric.metric === "extraction_correct")).toEqual({
      metric: "extraction_correct",
      samples: 2,
      mean: 0.5,
    });
  });

  it("computes prediction error only from labeled prediction outcomes", () => {
    const result = summarizeQuality([
      { metric: "predicted_correctness", value: 1, prediction: 0.8 },
      { metric: "predicted_correctness", value: 0, prediction: 0.4 },
      { metric: "incorrect_merge", value: 1, prediction: null },
    ]);
    expect(result.calibrationBrierScore).toBeCloseTo(0.1, 6);
  });

  it("records authorized labels and excludes another learner's message", async () => {
    const db = new Database(":memory:");
    try {
      const core = new CoreRepository(db);
      const knowledge = new KnowledgeRepository(db);
      const provider = createProvider({ TUTOR_PROVIDER: "disabled" });
      const first = core.signup("First learner");
      const second = core.signup("Second learner");
      const owner = z.object({ id: z.string() }).parse(first.learner).id;
      const conversation = z
        .object({ id: z.string() })
        .parse(core.createConversation(owner, "Quality review", null));
      const message = z
        .object({ id: z.string() })
        .parse(
          core.createMessage(owner, conversation.id, "learner", "A transition changes state."),
        );
      const app = new Hono();
      app.route(
        "/api",
        qualityRoutes({
          db,
          core,
          knowledge,
          documents: new KnowledgeDocumentRepository(db),
          provider,
          tutor: new TutorPipeline(db, core, knowledge, provider),
          turnLocks: new Set(),
          turnAttempts: new Map(),
        }),
      );
      app.onError((error, c) => {
        if (error instanceof ApiError) return c.json({ error: error.code }, error.status);
        throw error;
      });
      const request = (token: string) =>
        app.request("/api/quality/observations", {
          method: "POST",
          headers: { "content-type": "application/json", cookie: `tutor_session=${token}` },
          body: JSON.stringify({ messageId: message.id, metric: "extraction_correct", value: 1 }),
        });
      expect((await request(first.token)).status).toBe(201);
      expect((await request(second.token)).status).toBe(404);
      const response = await app.request("/api/quality/observations", {
        headers: { cookie: `tutor_session=${first.token}` },
      });
      const result = z
        .object({ observations: z.array(z.object({ metric: z.string() })) })
        .parse(await response.json());
      expect(result.observations).toEqual([{ metric: "extraction_correct" }]);
    } finally {
      db.close();
    }
  });
});
