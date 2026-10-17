import { createServer, type Server, type ServerResponse } from "node:http";
import { localContext } from "@slop-lab/part";
import { afterEach, expect, it } from "vitest";
import { createProvider } from "../../src/server/provider.js";

let server: Server | undefined;
afterEach(() => server?.closeAllConnections());

it("cancels the default local-embedding generation wrapper with its parent context", async () => {
  let response: ServerResponse | undefined;
  let requestCount = 0;
  let markReceived: (() => void) | undefined;
  const received = new Promise<void>((resolve) => {
    markReceived = resolve;
  });
  server = createServer((_request, pendingResponse) => {
    requestCount += 1;
    response = pendingResponse;
    markReceived?.();
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("fixture did not bind");
  const provider = createProvider({
    TUTOR_PROVIDER: "openai",
    OPENAI_API_KEY: "context-token",
    OPENAI_BASE_URL: `http://127.0.0.1:${address.port}`,
    TUTOR_MODEL: "fixture-model",
  });
  const controller = new AbortController();
  const pending = provider.call(
    call(),
    "learner-context",
    localContext({ signal: controller.signal }),
  );
  await received;

  controller.abort();
  const observed = await Promise.race([
    pending.then(
      () => ({ state: "resolved" as const }),
      (error: unknown) => ({ state: "rejected" as const, error }),
    ),
    new Promise<{ readonly state: "pending" }>((resolve) =>
      setTimeout(() => resolve({ state: "pending" }), 100),
    ),
  ]);

  response?.destroy();
  expect(observed).toMatchObject({ state: "rejected" });
  expect(requestCount).toBe(1);
  await pending.catch(() => undefined);
});

function call() {
  return {
    stage: "extraction" as const,
    version: "v1",
    system: "Extract",
    data: { message: "context" },
    jsonSchema: { type: "object", properties: {}, additionalProperties: false },
  };
}
