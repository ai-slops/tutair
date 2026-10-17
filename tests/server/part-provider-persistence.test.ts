import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Database } from "../../src/server/database.js";
import { ModelRunner } from "../../src/server/model-runner.js";
import { PartModelProvider } from "../../src/server/part-model-provider.js";
import { PartRuntime } from "../../src/server/part-runtime.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import { TutorStageRunner } from "../../src/server/tutor-stage.js";

const inspectionRow = z.object({
  status: z.string(),
  runtime_operation_id: z.string(),
  provider_operation_id: z.string(),
  provider_attempt_id: z.string(),
  effect_state: z.string(),
  output_json: z.string().nullable(),
  usage_json: z.string().nullable(),
});

describe("PART provider persistence", () => {
  let server: Server | undefined;
  afterEach(() => server?.closeAllConnections());

  it("records one bounded repair with independent IDs, raw output, and usage", async () => {
    let requestCount = 0;
    const baseUrl = await listen(async (request, response) => {
      for await (const chunk of request) void chunk;
      requestCount += 1;
      const content = requestCount === 1 ? '{"kind":"wrong"}' : '{"kind":"concept"}';
      response.setHeader("content-type", "application/json");
      response.end(completion(content, requestCount));
    });
    const fixture = createFixture(baseUrl);

    try {
      const result = await fixture.stages.stage({
        stage: "extraction",
        data: { message: "repair" },
        schema: z.object({ kind: z.literal("concept") }),
      });
      const rows = records(fixture.db);

      expect(result.value).toEqual({ kind: "concept" });
      expect(requestCount).toBe(2);
      expect(rows).toHaveLength(2);
      expect(rows.map((row) => row.status)).toEqual(["failed", "completed"]);
      expect(new Set(rows.map((row) => row.provider_operation_id)).size).toBe(2);
      expect(rows.every((row) => row.runtime_operation_id.length > 0)).toBe(true);
      expect(rows.every((row) => row.provider_attempt_id.length > 0)).toBe(true);
      expect(rows.map((row) => row.effect_state)).toEqual(["applied", "applied"]);
      expect(JSON.parse(rows[0]?.output_json ?? "null")).toEqual({ kind: "wrong" });
      expect(JSON.parse(rows[0]?.usage_json ?? "null")).toEqual({
        inputTokens: 3,
        outputTokens: 1,
        totalTokens: 4,
      });
    } finally {
      await fixture.runtime.dispose();
      fixture.db.close();
    }
  });

  it("records provider IDs and unknown effect after a dispatched HTTP failure", async () => {
    let requestCount = 0;
    const baseUrl = await listen((_request, response) => {
      requestCount += 1;
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { code: "upstream_failed", message: "failed" } }));
    });
    const fixture = createFixture(baseUrl);

    try {
      await expect(
        fixture.stages.stage({
          stage: "extraction",
          data: { message: "failure" },
          schema: z.object({ kind: z.literal("concept") }),
        }),
      ).rejects.toMatchObject({ code: "upstream_failed" });
      const row = records(fixture.db)[0];

      expect(requestCount).toBe(1);
      expect(row).toMatchObject({ status: "failed", effect_state: "unknown" });
      expect(row?.runtime_operation_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row?.provider_operation_id).toMatch(/^[0-9a-f-]{36}$/);
      expect(row?.provider_attempt_id).toMatch(/^[0-9a-f-]{36}$/);
    } finally {
      await fixture.runtime.dispose();
      fixture.db.close();
    }
  });

  it("persists raw output and known usage when completed output is invalid JSON", async () => {
    const baseUrl = await listen((_request, response) => {
      response.setHeader("content-type", "application/json");
      response.end(completion("not-json", 1));
    });
    const fixture = createFixture(baseUrl);

    try {
      await expect(
        fixture.stages.stage({
          stage: "extraction",
          data: { message: "invalid JSON" },
          schema: z.object({ kind: z.literal("concept") }),
        }),
      ).rejects.toMatchObject({ code: "provider_invalid_json" });
      const row = records(fixture.db)[0];

      expect(row).toMatchObject({ status: "failed", effect_state: "applied" });
      expect(JSON.parse(row?.output_json ?? "null")).toBe("not-json");
      expect(JSON.parse(row?.usage_json ?? "null")).toEqual({
        inputTokens: 3,
        outputTokens: 1,
        totalTokens: 4,
      });
    } finally {
      await fixture.runtime.dispose();
      fixture.db.close();
    }
  });

  function listen(handler: RequestListener): Promise<string> {
    server = createServer(handler);
    return new Promise((resolve) => {
      server?.listen(0, "127.0.0.1", () => {
        const address = server?.address();
        if (address === null || address === undefined || typeof address === "string")
          throw new Error("fixture did not bind");
        resolve(`http://127.0.0.1:${address.port}`);
      });
    });
  }
});

function createFixture(baseUrl: string) {
  const db = new Database(":memory:");
  const core = new CoreRepository(db);
  const owner = z.object({ id: z.string() }).parse(core.signup("PART persistence").learner).id;
  const conversation = z
    .object({ id: z.string() })
    .parse(core.createConversation(owner, "PART", null));
  const message = z
    .object({ id: z.string() })
    .parse(core.createMessage(owner, conversation.id, "learner", "PART"));
  const runtime = new PartRuntime(null);
  const provider = new PartModelProvider({
    runtime,
    stateProvider: "openai",
    stateModel: "fixture-model",
    outputMode: "strict",
    resolve: async () => ({
      accessToken: "persistence-token",
      model: "fixture-model",
      apiBaseUrl: baseUrl,
    }),
  });
  return {
    db,
    runtime,
    stages: new TutorStageRunner(new ModelRunner(db, provider, runtime), {
      owner,
      conversationId: conversation.id,
      messageId: message.id,
      content: "PART",
      assistance: "none",
      selfReport: "neutral",
    }),
  };
}

function records(db: Database) {
  return db.all(
    `SELECT r.status,i.runtime_operation_id,i.provider_operation_id,i.provider_attempt_id,
     i.effect_state,d.output_json,d.usage_json FROM model_runs r
     JOIN model_run_inspection i ON i.run_id=r.id JOIN model_run_details d ON d.run_id=r.id
     ORDER BY r.created_at,r.id`,
    [],
    inspectionRow,
  );
}

function completion(content: string, sequence: number): string {
  return JSON.stringify({
    choices: [{ index: 0, message: { content }, finish_reason: "stop" }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
    id: `fixture-${sequence}`,
  });
}
