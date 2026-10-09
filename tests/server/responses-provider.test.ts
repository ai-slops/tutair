import { createServer, type RequestListener, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { ResponsesProvider } from "../../src/server/responses-provider.js";

describe("Responses tutor provider", () => {
  let server: Server | undefined;
  afterEach(() => server?.close());

  it("uses the selected learner credential and requires a completed stream", async () => {
    let authorization: string | undefined;
    let body: Record<string, unknown> = {};
    const baseUrl = await fixture((request, response) => {
      authorization = request.headers.authorization;
      readJson(request).then((value) => {
        body = value;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(
          events(
            { type: "response.output_text.delta", delta: '{"claims":[]}' },
            {
              type: "response.completed",
              response: { usage: { input_tokens: 9, output_tokens: 4, total_tokens: 13 } },
            },
          ),
        );
      });
    });
    const provider = providerFor(baseUrl);

    const result = await provider.call(call(), "learner-1");

    expect(result).toEqual({
      value: { claims: [] },
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
    });
    expect(authorization).toBe("Bearer learner-token");
    expect(body).toMatchObject({ model: "gpt-fixture", stream: true, store: false });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("previous_response_id");
  });

  it.each([
    ["response.failed", { type: "response.failed", response: { error: { code: "usage_limit" } } }],
    ["response.incomplete", { type: "response.incomplete", response: { incomplete_details: {} } }],
    ["truncated", { type: "response.output_text.delta", delta: '{"claims":[]}' }],
  ])("rejects %s streams", async (_name, terminal) => {
    const baseUrl = await fixture((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(events(terminal));
    });

    await expect(providerFor(baseUrl).call(call(), "learner-1")).rejects.toMatchObject({
      code: "responses_incomplete",
    });
  });

  function fixture(handler: RequestListener): Promise<string> {
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

function providerFor(baseUrl: string): ResponsesProvider {
  return new ResponsesProvider({
    stateProvider: "chatgpt",
    stateModel: null,
    resolve: async (owner) => {
      if (owner !== "learner-1") throw new Error("cross-learner credential request");
      return { accessToken: "learner-token", model: "gpt-fixture", apiBaseUrl: baseUrl };
    },
  });
}

function call() {
  return {
    stage: "extraction" as const,
    version: "phase1-v1",
    system: "Extract",
    data: { message: "data" },
    jsonSchema: { type: "object" },
  };
}

function events(...values: readonly unknown[]): string {
  return values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("");
}

async function readJson(
  request: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
