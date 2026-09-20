import { createServer } from "node:http";
import { expect, it } from "vitest";
import { z } from "zod";
import { createProvider } from "../../src/server/provider.js";

it("opts into streaming JSON without unsupported output or tool parameters", async () => {
  let body: unknown;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request)
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    body = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    response.setHeader("content-type", "text/event-stream");
    response.end(
      'data:{"choices":[{"delta":{"content":"{\\"ok\\":true}"}}]}\n\ndata:{"choices":[{"delta":{},"finish_reason":"stop"}]}\n\ndata:[DONE]\n\n',
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Server did not bind");
    const schema = {
      type: "object",
      properties: { ok: { type: "boolean" } },
      required: ["ok"],
      additionalProperties: false,
    };
    const provider = createProvider({
      TUTOR_PROVIDER: "openai",
      TUTOR_OPENAI_MODE: "compatibility",
      OPENAI_API_KEY: "test-key",
      OPENAI_BASE_URL: `http://127.0.0.1:${address.port}`,
      TUTOR_MODEL: "test-model",
      TUTOR_EMBEDDING_PROVIDER: "disabled",
    });
    expect(
      await provider.call({
        stage: "planning",
        version: "v1",
        system: "Plan",
        data: { message: "Explain states" },
        jsonSchema: schema,
      }),
    ).toEqual({ value: { ok: true }, usage: null });
    const sent = z
      .object({
        stream: z.literal(true),
        max_tokens: z.number().positive(),
        messages: z.array(z.object({ role: z.string(), content: z.string() })),
      })
      .passthrough()
      .parse(body);
    expect(sent["response_format"]).toBeUndefined();
    expect(sent["tools"]).toBeUndefined();
    expect(sent["temperature"]).toBeUndefined();
    const policy = JSON.parse(
      sent.messages.find((message) => message.role === "user")?.content ?? "{}",
    );
    expect(z.object({ outputSchema: z.unknown() }).parse(policy).outputSchema).toEqual(schema);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
