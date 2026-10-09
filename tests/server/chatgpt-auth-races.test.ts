import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatGptAuth } from "../../src/server/chatgpt-auth.js";
import { ProtectedTokenStore } from "../../src/server/chatgpt-token-store.js";

type Deferred = {
  readonly promise: Promise<void>;
  resolve(): void;
};

describe("ChatGPT disconnect races", () => {
  let server: Server;
  let auth: ChatGptAuth;
  let store: ProtectedTokenStore;
  let nonce: string | undefined;
  let pauseGrant: "authorization_code" | "refresh_token" | undefined;
  let reached: Deferred;
  let release: Deferred;
  let pauseModels: boolean;
  let modelsReached: Deferred;
  let modelsRelease: Deferred;
  let now = Date.now();
  let port = 0;

  beforeEach(async () => {
    const keys = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: "fixture", alg: "RS256" };
    nonce = undefined;
    pauseGrant = undefined;
    reached = deferred();
    release = deferred();
    pauseModels = false;
    modelsReached = deferred();
    modelsRelease = deferred();
    server = createServer(async (request, response) => {
      const base = `http://127.0.0.1:${port}`;
      if (request.url === "/jwks") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      if (request.url === "/token") {
        const chunks: Buffer[] = [];
        for await (const chunk of request)
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const form = new URLSearchParams(Buffer.concat(chunks).toString("utf8"));
        if (pauseGrant === form.get("grant_type")) {
          reached.resolve();
          await release.promise;
        }
        const idToken = await new SignJWT({
          sub: "account-1",
          ...(nonce === undefined ? {} : { nonce }),
        })
          .setProtectedHeader({ alg: "RS256", kid: "fixture" })
          .setIssuer(base)
          .setAudience(form.get("client_id") ?? "oaiapp_fixture")
          .setExpirationTime("5m")
          .setIssuedAt()
          .sign(keys.privateKey);
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: "refresh-1",
            id_token: idToken,
            expires_in: 3600,
            scope: "openid offline_access resource.invoke chatgpt.tokens.use.direct",
            token_type: "Bearer",
          }),
        );
        return;
      }
      if (request.url === "/models") {
        if (pauseModels) {
          modelsReached.resolve();
          await modelsRelease.promise;
        }
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            models: [{ slug: "gpt-listed", display_name: "GPT Listed", visibility: "list" }],
          }),
        );
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("fixture did not bind");
    port = address.port;
    const baseUrl = `http://127.0.0.1:${port}`;
    store = new ProtectedTokenStore(join(tmpdir(), `tutair-auth-race-${crypto.randomUUID()}.json`));
    auth = new ChatGptAuth({
      enabled: true,
      callbackPort: 1455,
      authorizationUrl: `${baseUrl}/authorize`,
      tokenUrl: `${baseUrl}/token`,
      jwksUrl: `${baseUrl}/jwks`,
      issuer: baseUrl,
      apiBaseUrl: baseUrl,
      store,
      now: () => now,
    });
  });

  afterEach(() => server.close());

  it("does not restore credentials when disconnect races a callback exchange", async () => {
    const started = await auth.begin("learner-1");
    nonce = requiredNonce(started.url);
    pauseGrant = "authorization_code";
    const completing = complete(auth, started.state);
    await reached.promise;

    await auth.disconnect("learner-1");
    release.resolve();

    await expect(completing).rejects.toMatchObject({ code: "oauth_session_invalidated" });
    expect(await store.read("learner-1")).toBeNull();
  });

  it("does not restore credentials when disconnect races a refresh", async () => {
    const started = await auth.begin("learner-1");
    nonce = requiredNonce(started.url);
    await complete(auth, started.state);
    now += 3_700_000;
    nonce = undefined;
    pauseGrant = "refresh_token";
    const refreshing = auth.credential("learner-1");
    await reached.promise;

    await auth.disconnect("learner-1");
    release.resolve();

    await expect(refreshing).rejects.toMatchObject({ code: "oauth_session_invalidated" });
    expect(await store.read("learner-1")).toBeNull();
  });

  it("does not restore model selection when disconnect overlaps model discovery", async () => {
    const started = await auth.begin("learner-1");
    nonce = requiredNonce(started.url);
    await complete(auth, started.state);
    pauseModels = true;
    const selecting = auth.selectModel("learner-1", "gpt-listed");
    await modelsReached.promise;

    await auth.disconnect("learner-1");
    modelsRelease.resolve();

    await expect(selecting).rejects.toMatchObject({ code: "oauth_session_invalidated" });
    expect(await store.read("learner-1")).toBeNull();
  });

  it("preserves a model selected while token refresh is in flight", async () => {
    const started = await auth.begin("learner-1");
    nonce = requiredNonce(started.url);
    await complete(auth, started.state);
    pauseModels = true;
    const selecting = auth.selectModel("learner-1", "gpt-listed");
    await modelsReached.promise;
    now += 3_700_000;
    nonce = undefined;
    pauseGrant = "refresh_token";
    const refreshing = auth.credential("learner-1");
    await reached.promise;

    modelsRelease.resolve();
    await selecting;
    release.resolve();

    await expect(refreshing).resolves.toMatchObject({ selectedModel: "gpt-listed" });
    expect(await store.read("learner-1")).toMatchObject({ selectedModel: "gpt-listed" });
  });
});

function complete(auth: ChatGptAuth, state: string): Promise<string> {
  return auth.complete(new URLSearchParams({ code: "code-1", state, client_id: "oaiapp_fixture" }));
}

function requiredNonce(url: string): string {
  const value = new URL(url).searchParams.get("nonce");
  if (value === null) throw new Error("authorization URL omitted nonce");
  return value;
}

function deferred(): Deferred {
  let resolve = (): void => undefined;
  const promise = new Promise<void>((complete) => {
    resolve = complete;
  });
  return { promise, resolve };
}
