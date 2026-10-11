import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ChatGptAuth } from "../../src/server/chatgpt-auth.js";
import { ProtectedTokenStore } from "../../src/server/chatgpt-token-store.js";

describe("Sign in with ChatGPT host identity", () => {
  it("sends a stable UUIDv4 URI as the agent host identifier", async () => {
    // Given
    const store = new ProtectedTokenStore(
      join(tmpdir(), `tutair-host-id-${crypto.randomUUID()}.json`),
    );
    const auth = new ChatGptAuth({
      enabled: true,
      callbackPort: 1455,
      authorizationUrl: "https://auth.example.test/authorize",
      tokenUrl: "https://auth.example.test/token",
      jwksUrl: "https://auth.example.test/jwks",
      issuer: "https://auth.example.test",
      apiBaseUrl: "https://api.example.test",
      store,
    });
    const expectedHostId = await store.hostId();

    // When
    const first = new URL((await auth.begin("learner-1")).url);
    const second = new URL((await auth.begin("learner-1")).url);

    // Then
    expect(first.searchParams.get("ext_agent_host_id")).toBe(expectedHostId);
    expect(second.searchParams.get("ext_agent_host_id")).toBe(expectedHostId);
    expect(expectedHostId).toMatch(
      /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });
});
