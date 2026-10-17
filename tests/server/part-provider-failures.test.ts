import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { PartModelProvider } from "../../src/server/part-model-provider.js";
import { PartRuntime } from "../../src/server/part-runtime.js";

const runtimeFailure = z
  .object({
    code: z.string(),
    runtime: z.object({
      operationId: z.uuid(),
      attemptId: z.uuid(),
      phase: z.string(),
      effect: z.enum(["not-attempted", "not-applied", "applied", "partially-applied", "unknown"]),
    }),
    usage: z
      .object({ inputTokens: z.number(), outputTokens: z.number(), totalTokens: z.number() })
      .nullable()
      .optional(),
    rawOutput: z.string().optional(),
  })
  .catchall(z.unknown());

describe("PART provider failure evidence", () => {
  let server: Server | undefined;
  afterEach(() => server?.closeAllConnections());

  it.each([
    {
      name: "HTTP 500",
      response: {
        status: 500,
        body: JSON.stringify({ error: { code: "upstream", message: "failed" } }),
      },
      code: "upstream",
      effect: "unknown",
      usage: null,
    },
    {
      name: "HTTP 429",
      response: {
        status: 429,
        body: JSON.stringify({ error: { code: "quota", message: "limited" } }),
      },
      code: "quota",
      effect: "unknown",
      usage: null,
    },
    {
      name: "malformed response",
      response: { status: 200, body: "{" },
      code: "part.openai-compatible.decode",
      effect: "applied",
      usage: null,
    },
    {
      name: "truncated output",
      response: { status: 200, body: completion('{"ok":true}', "length") },
      code: "provider_truncated_output",
      effect: "applied",
      usage: null,
      rawOutput: '{"ok":true}',
    },
    {
      name: "invalid JSON output",
      response: {
        status: 200,
        body: completion("not-json", "stop", {
          prompt_tokens: 7,
          completion_tokens: 2,
          total_tokens: 9,
        }),
      },
      code: "provider_invalid_json",
      effect: "applied",
      usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 },
      rawOutput: "not-json",
    },
  ])("preserves IDs and conservative effect for $name", async (fixtureCase) => {
    let requestCount = 0;
    const baseUrl = await listen((_request, response) => {
      requestCount += 1;
      response.writeHead(fixtureCase.response.status, { "content-type": "application/json" });
      response.end(fixtureCase.response.body);
    });

    const error = await rejected(providerFor(baseUrl).call(call(), "learner-failure"));
    const parsed = runtimeFailure.parse(error);

    expect(parsed.code).toBe(fixtureCase.code);
    expect(parsed.runtime).toMatchObject({ phase: expect.any(String), effect: fixtureCase.effect });
    expect(parsed.usage).toEqual(fixtureCase.usage);
    expect(parsed.rawOutput).toBe(fixtureCase.rawOutput);
    expect(requestCount).toBe(1);
  });

  it("preserves IDs and unknown effect when the deadline aborts before headers", async () => {
    let requestCount = 0;
    const baseUrl = await listen(() => {
      requestCount += 1;
    });

    const error = runtimeFailure.parse(
      await rejected(providerFor(baseUrl, 20).call(call(), "learner-failure")),
    );

    expect(error).toMatchObject({ code: "provider_timeout", runtime: { effect: "unknown" } });
    expect(requestCount).toBe(1);
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

function providerFor(baseUrl: string, requestTimeoutMs?: number): PartModelProvider {
  return new PartModelProvider({
    runtime: new PartRuntime(null),
    stateProvider: "openai",
    stateModel: "fixture-model",
    outputMode: "strict",
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    resolve: async () => ({
      accessToken: "failure-token",
      model: "fixture-model",
      apiBaseUrl: baseUrl,
    }),
  });
}

function call() {
  return {
    stage: "extraction" as const,
    version: "v1",
    system: "Extract",
    data: { message: "failure" },
    jsonSchema: {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    },
  };
}

function completion(
  content: string,
  finishReason: string,
  usage?: Readonly<Record<string, number>>,
): string {
  return JSON.stringify({
    choices: [{ index: 0, message: { content }, finish_reason: finishReason }],
    ...(usage === undefined ? {} : { usage }),
  });
}

async function rejected(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error("expected provider call to reject");
}
