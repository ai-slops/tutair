import { localContext } from "@slop-lab/part";
import { expect, it } from "vitest";
import { createTutorTransport } from "../../src/server/part-transport.js";

it("redacts echoed credentials and generic authorization patterns before returning diagnostics", async () => {
  const credential = "exact-secret-fixture";
  const fetchImplementation: typeof fetch = async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "denied",
          message: `Authorization: Bearer ${credential}\napi_key=other-secret token: third-secret`,
        },
      }),
      { status: 401, headers: { "content-type": "application/json" } },
    );
  const transport = createTutorTransport(["https://provider.example"], fetchImplementation);

  const result = await transport.send(
    {
      protocol: "fixture",
      mediaType: "application/json",
      body: new Uint8Array(),
      digest: "request",
      metadata: {},
      inspectionBoundary: "outgoing-body",
    },
    {
      id: "fixture",
      revision: "1",
      adapterId: "fixture",
      transportId: transport.id,
      authStrategyId: "fixture",
      model: "fixture",
      endpoint: "https://provider.example/v1/responses",
      defaults: {},
      capabilities: { revision: "1", entries: [] },
    },
    { strategy: "bearer", material: credential },
    localContext({ correlationId: "redaction-fixture" }),
  );

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected transport failure");
  expect(result.error.message).toContain("[redacted]");
  expect(result.error.message).not.toContain(credential);
  expect(result.error.message).not.toContain("other-secret");
  expect(result.error.message).not.toContain("third-secret");
});

it("uses a generic diagnostic when the upstream message is whitespace only", async () => {
  const transport = createTutorTransport(
    ["https://provider.example"],
    async () =>
      new Response(JSON.stringify({ error: { code: "failed", message: " \n\t " } }), {
        status: 500,
      }),
  );

  const result = await transport.send(
    {
      protocol: "fixture",
      mediaType: "application/json",
      body: new Uint8Array(),
      digest: "request",
      metadata: {},
      inspectionBoundary: "outgoing-body",
    },
    {
      id: "fixture",
      revision: "1",
      adapterId: "fixture",
      transportId: transport.id,
      authStrategyId: "fixture",
      model: "fixture",
      endpoint: "https://provider.example/v1/responses",
      defaults: {},
      capabilities: { revision: "1", entries: [] },
    },
    { strategy: "bearer", material: "fixture-secret" },
    localContext({ correlationId: "whitespace-fixture" }),
  );

  expect(result.ok).toBe(false);
  if (result.ok) throw new Error("expected transport failure");
  expect(result.error.message).toBe("Provider request failed");
});
