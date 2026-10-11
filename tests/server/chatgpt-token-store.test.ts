import { readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { ProtectedTokenStore, type StoredGrant } from "../../src/server/chatgpt-token-store.js";

const UUID_HOST_ID_PATTERN =
  /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

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
    // Given
    const path = fixturePath();
    const firstStore = new ProtectedTokenStore(path);
    const secondStore = new ProtectedTokenStore(path);

    // When
    const [first, second] = await Promise.all([firstStore.hostId(), secondStore.hostId()]);
    const before = await stat(path);
    const repeated = await firstStore.hostId();
    const after = await stat(path);

    // Then
    expect(second).toBe(first);
    expect(repeated).toBe(first);
    expect(first).toMatch(UUID_HOST_ID_PATTERN);
    expect(after.ino).toBe(before.ino);
  });

  it("migrates a persisted bare UUID without changing its identity or grants", async () => {
    // Given
    const path = fixturePath();
    const legacyUuid = "b4f86cc4-8b9b-49f6-88d8-d8b88be4cf12";
    const grant = fixtureGrant("account-1");
    await writeFile(
      path,
      JSON.stringify({ version: 1, hostId: legacyUuid, grants: { "learner-1": grant } }),
      "utf8",
    );
    const store = new ProtectedTokenStore(path);

    // When
    const first = await store.hostId();
    const repeated = await new ProtectedTokenStore(path).hostId();

    // Then
    expect(first).toBe(`urn:uuid:${legacyUuid}`);
    expect(repeated).toBe(first);
    expect(await store.read("learner-1")).toEqual(grant);
    expect(JSON.parse(await readFile(path, "utf8"))).toMatchObject({
      hostId: `urn:uuid:${legacyUuid}`,
      grants: { "learner-1": grant },
    });
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
