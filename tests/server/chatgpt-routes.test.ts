import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createApp } from "../../src/server/app.js";
import { ChatGptAuth } from "../../src/server/chatgpt-auth.js";
import { ProtectedTokenStore } from "../../src/server/chatgpt-token-store.js";

describe("personal ChatGPT route boundaries", () => {
  it("isolates status by learner and never returns stored tokens", async () => {
    const store = new ProtectedTokenStore(
      join(tmpdir(), `tutair-route-${crypto.randomUUID()}.json`),
    );
    const auth = fixtureAuth(store);
    const { app, database } = createApp({
      databasePath: ":memory:",
      env: { TUTOR_PROVIDER: "demo", TUTOR_EMBEDDING_PROVIDER: "disabled" },
      chatgptAuth: auth,
    });
    const learnerA = await signup(app);
    const learnerB = await signup(app);
    await store.write(learnerA.id, fixtureGrant());

    const statusA = await app.request("http://127.0.0.1/api/chatgpt/status", {
      headers: { cookie: learnerA.cookie },
    });
    const statusB = await app.request("http://127.0.0.1/api/chatgpt/status", {
      headers: { cookie: learnerB.cookie },
    });

    expect(await statusA.json()).toMatchObject({ connected: true, subject: "account-1" });
    expect(await statusB.json()).toMatchObject({ connected: false });
    const capabilitiesResponse = await app.request("http://127.0.0.1/api/capabilities", {
      headers: { cookie: learnerA.cookie },
    });
    expect(JSON.stringify(await capabilitiesResponse.json())).not.toContain("access-secret");
    database.close();
  });

  it("rejects authorization initiation outside the exact loopback origin", async () => {
    const auth = fixtureAuth(
      new ProtectedTokenStore(join(tmpdir(), `tutair-route-${crypto.randomUUID()}.json`)),
    );
    const { app, database } = createApp({
      databasePath: ":memory:",
      env: { TUTOR_PROVIDER: "demo", TUTOR_EMBEDDING_PROVIDER: "disabled" },
      chatgptAuth: auth,
    });
    const learner = await signup(app);

    const response = await app.request("https://public.example/api/chatgpt/connect", {
      headers: { cookie: learner.cookie, origin: "https://public.example" },
    });

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ error: { code: "local_bridge_required" } });
    database.close();
  });
});

function fixtureAuth(store: ProtectedTokenStore): ChatGptAuth {
  return new ChatGptAuth({
    enabled: true,
    callbackPort: 1455,
    authorizationUrl: "https://auth.example/authorize",
    tokenUrl: "https://auth.example/token",
    jwksUrl: "https://auth.example/jwks",
    issuer: "https://auth.example",
    apiBaseUrl: "https://api.example/v1",
    store,
  });
}

function fixtureGrant() {
  return {
    clientId: "oaiapp_fixture",
    issuer: "https://auth.example",
    subject: "account-1",
    scopes: ["chatgpt.tokens.use.direct"],
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    idToken: "identity-secret",
    expiresAt: Date.now() + 60_000,
    selectedModel: null,
  };
}

async function signup(app: ReturnType<typeof createApp>["app"]) {
  const response = await app.request("http://127.0.0.1/api/auth/local-signup", {
    method: "POST",
    headers: { origin: "http://127.0.0.1", "content-type": "application/json" },
    body: JSON.stringify({ displayName: "Learner" }),
  });
  const body = (await response.json()) as { readonly learner: { readonly id: string } };
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (cookie === undefined) throw new Error("signup omitted cookie");
  return { id: body.learner.id, cookie };
}
