import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createProvider } from "../../src/server/provider.js";

const requestSchema = z
  .object({
    response_format: z.object({
      type: z.literal("json_schema"),
      json_schema: z.object({
        name: z.string(),
        strict: z.literal(true),
        schema: z.object({}).passthrough(),
      }),
    }),
  })
  .passthrough();

describe("OpenAI-compatible provider wire seam", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  it("sends bearer auth and strict structured-output schema", async () => {
    let authorization: string | undefined;
    let requestBody: unknown;
    server = createServer(async (request, response) => {
      authorization = request.headers.authorization;
      const chunks: Buffer[] = [];
      for await (const chunk of request)
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8"));
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          choices: [
            {
              index: 0,
              message: { content: JSON.stringify({ claims: [] }) },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 11, completion_tokens: 3, total_tokens: 14 },
        }),
      );
    });
    await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string")
      throw new Error("test server did not bind");
    const provider = createProvider({
      TUTOR_PROVIDER: "openai",
      OPENAI_API_KEY: "secret",
      OPENAI_BASE_URL: `http://127.0.0.1:${address.port}`,
      TUTOR_MODEL: "fake-model",
    });
    const result = await provider.call(
      {
        stage: "extraction",
        version: "phase1-v1",
        system: "Extract",
        data: { message: "data" },
        jsonSchema: { type: "object" },
      },
      "learner-1",
    );
    expect(result).toMatchObject({
      value: { claims: [] },
      usage: { inputTokens: 11, outputTokens: 3, totalTokens: 14 },
      resolvedModel: "fake-model",
      runtime: {
        operationId: expect.any(String),
        attemptId: expect.any(String),
        effect: "applied",
      },
    });
    expect(authorization).toBe("Bearer secret");
    expect(requestSchema.parse(requestBody).response_format.json_schema.name).toBe(
      "extraction_phase1_v1",
    );
    const wireSchema = requestSchema.parse(requestBody).response_format.json_schema.schema;
    expect(wireSchema).toMatchObject({ type: "object", additionalProperties: false });
  });
});
