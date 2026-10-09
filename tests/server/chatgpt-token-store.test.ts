import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProtectedTokenStore, type StoredGrant } from "../../src/server/chatgpt-token-store.js";

describe("ProtectedTokenStore concurrency", () => {
  it("preserves both owners when writes start concurrently", async () => {
    const path = fixturePath();
    const firstStore = new ProtectedTokenStore(path);
    const secondStore = new ProtectedTokenStore(path);

    await Promise.all([
      firstStore.write("learner-1", fixtureGrant("account-1")),
      secondStore.write("learner-2", fixtureGrant("account-2")),
    ]);

    expect(await firstStore.read("learner-1")).toMatchObject({ subject: "account-1" });
    expect(await firstStore.read("learner-2")).toMatchObject({ subject: "account-2" });
  });

  it("returns one stable host ID when first calls start concurrently", async () => {
    const path = fixturePath();
    const firstStore = new ProtectedTokenStore(path);
    const secondStore = new ProtectedTokenStore(path);

    const [first, second] = await Promise.all([firstStore.hostId(), secondStore.hostId()]);
    const before = await stat(path);
    const repeated = await firstStore.hostId();
    const after = await stat(path);

    expect(second).toBe(first);
    expect(repeated).toBe(first);
    expect(after.ino).toBe(before.ino);
  });

  it("rejects model selection when the owner has no grant", async () => {
    const store = fixtureStore();

    const selecting = store.selectModel("learner-1", "gpt-listed");

    await expect(selecting).rejects.toMatchObject({ code: "chatgpt_not_connected" });
  });
});

function fixtureStore(): ProtectedTokenStore {
  return new ProtectedTokenStore(fixturePath());
}

function fixturePath(): string {
  return join(tmpdir(), `tutair-store-${crypto.randomUUID()}.json`);
}

function fixtureGrant(subject: string): StoredGrant {
  return {
    clientId: "oaiapp_fixture",
    issuer: "https://auth.example.test",
    subject,
    scopes: ["chatgpt.tokens.use.direct"],
    accessToken: `access-${subject}`,
    refreshToken: `refresh-${subject}`,
    idToken: `identity-${subject}`,
    expiresAt: Date.now() + 3_600_000,
    selectedModel: null,
  };
}
