import { createServer, type RequestListener, type Server, type ServerResponse } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { PartModelProvider } from "../../src/server/part-model-provider.js";
import { PartRuntime } from "../../src/server/part-runtime.js";

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
            completed('{"claims":[]}', { input_tokens: 9, output_tokens: 4, total_tokens: 13 }),
          ),
        );
      });
    });
    const provider = providerFor(baseUrl);

    const result = await provider.call(call(false), "learner-1");

    expect(result).toMatchObject({
      value: { claims: [] },
      usage: { inputTokens: 9, outputTokens: 4, totalTokens: 13 },
      resolvedModel: "gpt-fixture",
      reasoningSummary: { state: "disabled" },
    });
    expect(authorization).toBe("Bearer learner-token");
    expect(body).toMatchObject({ model: "gpt-fixture", stream: true, store: false });
    expect(body).toMatchObject({ include: [] });
    expect(body).toMatchObject({
      input: [{ role: "user", content: JSON.stringify({ message: "data" }) }],
    });
    expect(body).toMatchObject({
      text: {
        format: {
          schema: {
            type: "object",
            required: ["claims", "note", "metadata"],
            additionalProperties: false,
            properties: {
              metadata: {
                type: "object",
                required: ["source"],
                additionalProperties: false,
              },
            },
          },
        },
      },
    });
    expect(body).not.toHaveProperty("temperature");
    expect(body).not.toHaveProperty("previous_response_id");
    expect(body).not.toHaveProperty("reasoning");
  });

  it("requests and returns only an official Responses reasoning summary when enabled", async () => {
    // Given
    let body: Record<string, unknown> = {};
    const baseUrl = await fixture((request, response) => {
      readJson(request).then((value) => {
        body = value;
        response.writeHead(200, { "content-type": "text/event-stream" });
        response.end(
          events(
            completed('{"claims":[]}', null, [
              {
                id: "reasoning_fixture",
                type: "reasoning",
                status: "completed",
                summary: [{ type: "summary_text", text: "Checked the supplied definition." }],
              },
            ]),
          ),
        );
      });
    });

    // When
    const result = await providerFor(baseUrl).call(call(true), "learner-1");

    // Then
    expect(body).toMatchObject({ reasoning: { summary: "auto" } });
    expect(result).toMatchObject({
      reasoningSummary: { state: "available", text: "Checked the supplied definition." },
    });
  });

  it("reports unavailable when an enabled Responses model returns no public summary", async () => {
    // Given
    const baseUrl = await fixture((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(events(completed('{"claims":[]}', null)));
    });

    // When
    const result = await providerFor(baseUrl).call(call(true), "learner-1");

    // Then
    expect(result).toMatchObject({ reasoningSummary: { state: "unavailable" } });
  });

  it.each([
    ["response.failed", { type: "response.failed", response: { error: { code: "usage_limit" } } }],
    ["response.incomplete", { type: "response.incomplete", response: { incomplete_details: {} } }],
    [
      "truncated",
      {
        type: "response.created",
        response: { id: "resp_fixture", status: "in_progress", error: null },
      },
    ],
  ])("rejects %s streams", async (_name, terminal) => {
    const baseUrl = await fixture((_request, response) => {
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.end(events(terminal));
    });

    await expect(providerFor(baseUrl).call(call(), "learner-1")).rejects.toMatchObject({
      code: "responses_incomplete",
    });
  });

  it("bounds the response body lifetime after streaming headers arrive", async () => {
    let openResponse: ServerResponse | undefined;
    const baseUrl = await fixture((_request, response) => {
      openResponse = response;
      response.writeHead(200, { "content-type": "text/event-stream" });
      response.write(
        events({
          type: "response.created",
          response: { id: "resp_fixture", status: "in_progress", error: null },
        }),
      );
    });
    const request = providerFor(baseUrl, 25).call(call(), "learner-1");
    const observed = await Promise.race([
      request.then(
        () => ({ kind: "resolved" as const }),
        (error: unknown) => ({ kind: "rejected" as const, error }),
      ),
      new Promise<{ readonly kind: "pending" }>((resolve) =>
        setTimeout(() => resolve({ kind: "pending" }), 100),
      ),
    ]);

    try {
      expect(observed).toMatchObject({
        kind: "rejected",
        error: { code: "provider_timeout" },
      });
    } finally {
      openResponse?.destroy();
      await request.catch(() => undefined);
    }
  });

  it("preserves documented plan quota errors and request IDs", async () => {
    const baseUrl = await fixture((_request, response) => {
      response.writeHead(429, {
        "content-type": "application/json",
        "x-request-id": "req_fixture",
      });
      response.end(
        JSON.stringify({
          error: {
            code: "subscription_sharing_usage_limit_exceeded",
            message: "ChatGPT plan usage limit reached",
          },
        }),
      );
    });

    await expect(providerFor(baseUrl).call(call(), "learner-1")).rejects.toMatchObject({
      status: 429,
      code: "subscription_sharing_usage_limit_exceeded",
      details: { requestId: "req_fixture" },
    });
  });

  it("preserves sanitized direct-admission diagnostics and request IDs", async () => {
    // Given
    const baseUrl = await fixture((_request, response) => {
      response.writeHead(400, {
        "content-type": "application/json",
        "x-request-id": "req_admission_fixture",
      });
      response.end(JSON.stringify({ detail: "Input must be an array" }));
    });

    // When
    const request = providerFor(baseUrl).call(call(), "learner-1");

    // Then
    await expect(request).rejects.toMatchObject({
      status: 400,
      code: "provider_http_error",
      message: "Input must be an array",
      details: { requestId: "req_admission_fixture" },
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

function providerFor(baseUrl: string, requestTimeoutMs?: number): PartModelProvider {
  return new PartModelProvider({
    runtime: new PartRuntime(null),
    stateProvider: "chatgpt",
    stateModel: null,
    outputMode: "responses",
    ...(requestTimeoutMs === undefined ? {} : { requestTimeoutMs }),
    resolve: async (owner) => {
      if (owner !== "learner-1") throw new Error("cross-learner credential request");
      return { accessToken: "learner-token", model: "gpt-fixture", apiBaseUrl: baseUrl };
    },
  });
}

function call(reasoningSummaryEnabled = false) {
  return {
    stage: "extraction" as const,
    version: "phase1-v1",
    system: "Extract",
    data: { message: "data" },
    jsonSchema: {
      type: "object",
      properties: {
        claims: { type: "array", items: { type: "string" } },
        note: { type: ["string", "null"] },
        metadata: { type: "object", properties: { source: { type: "string" } } },
      },
    },
    reasoningSummaryEnabled,
  };
}

function events(...values: readonly unknown[]): string {
  return values.map((value) => `data: ${JSON.stringify(value)}\n\n`).join("");
}

function completed(
  text: string,
  usage: {
    readonly input_tokens: number;
    readonly output_tokens: number;
    readonly total_tokens: number;
  } | null,
  extraOutput: readonly unknown[] = [],
) {
  return {
    type: "response.completed",
    response: {
      id: "resp_fixture",
      object: "response",
      status: "completed",
      error: null,
      incomplete_details: null,
      output: [
        {
          id: "message_fixture",
          type: "message",
          role: "assistant",
          status: "completed",
          content: [{ type: "output_text", text, annotations: [] }],
        },
        ...extraOutput,
      ],
      usage,
    },
  };
}

async function readJson(
  request: import("node:http").IncomingMessage,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request)
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
