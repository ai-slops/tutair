import { readFile, stat } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ChatGptAuth } from "../../src/server/chatgpt-auth.js";
import { ProtectedTokenStore } from "../../src/server/chatgpt-token-store.js";

describe("Sign in with ChatGPT authorization", () => {
  let server: Server;
  let auth: ChatGptAuth;
  let tokenStore: ProtectedTokenStore;
  let tokenClaims: Readonly<Record<string, unknown>>;
  const callbackClientId = "oaiapp_fixture";
  let tokenRefresh = "refresh-1";
  let tokenNonce: string | undefined;
  let tokenScope: string | undefined;
  let includeExpiration = true;
  let now = Date.now();
  let port = 0;

  beforeEach(async () => {
    const keys = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: "fixture", alg: "RS256" };
    tokenClaims = { sub: "account-1" };
    tokenNonce = undefined;
    tokenScope = "openid profile offline_access resource.invoke chatgpt.tokens.use.direct";
    includeExpiration = true;
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
        let signer = new SignJWT({
          ...tokenClaims,
          ...(tokenNonce === undefined ? {} : { nonce: tokenNonce }),
        })
          .setProtectedHeader({ alg: "RS256", kid: "fixture" })
          .setIssuer(base)
          .setAudience(form.get("client_id") ?? callbackClientId)
          .setIssuedAt();
        if (includeExpiration) signer = signer.setExpirationTime("5m");
        const idToken = await signer.sign(keys.privateKey);
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: "access-1",
            refresh_token: tokenRefresh,
            id_token: idToken,
            expires_in: 3600,
            ...(tokenScope === undefined ? {} : { scope: tokenScope }),
            token_type: "Bearer",
          }),
        );
        return;
      }
      if (request.url === "/models") {
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            models: [
              { slug: "gpt-listed", display_name: "GPT Listed", visibility: "list" },
              { slug: "gpt-hidden", display_name: "GPT Hidden", visibility: "hidden" },
            ],
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
    const dataPath = join(tmpdir(), `tutair-auth-${crypto.randomUUID()}.json`);
    tokenStore = new ProtectedTokenStore(dataPath);
    auth = new ChatGptAuth({
      enabled: true,
      callbackPort: 1455,
      authorizationUrl: `${baseUrl()}/authorize`,
      tokenUrl: `${baseUrl()}/token`,
      jwksUrl: `${baseUrl()}/jwks`,
      issuer: baseUrl(),
      apiBaseUrl: baseUrl(),
      store: tokenStore,
      now: () => now,
    });
  });

  afterEach(() => server.close());

  it("rejects a callback with the wrong state before token exchange", async () => {
    const started = await auth.begin("learner-1");
    tokenNonce = requiredNonce(started.url);

    await expect(
      auth.complete(
        new URLSearchParams({ code: "code-1", state: "wrong", client_id: callbackClientId }),
      ),
    ).rejects.toMatchObject({ code: "oauth_state_invalid" });
  });

  it("stores a validated grant atomically with owner-only permissions", async () => {
    const started = await auth.begin("learner-1");
    tokenNonce = requiredNonce(started.url);

    await auth.complete(
      new URLSearchParams({ code: "code-1", state: started.state, client_id: callbackClientId }),
    );

    expect(await auth.status("learner-1")).toMatchObject({
      connected: true,
      subject: "account-1",
      clientId: callbackClientId,
    });
    expect((await stat(tokenStore.path)).mode & 0o777).toBe(0o600);
    expect(await readFile(tokenStore.path, "utf8")).not.toContain("learner-2");
  });

  it("rejects an ID token with the wrong nonce", async () => {
    const started = await auth.begin("learner-1");
    tokenNonce = "another-nonce";

    await expect(
      auth.complete(
        new URLSearchParams({ code: "code-1", state: started.state, client_id: callbackClientId }),
      ),
    ).rejects.toMatchObject({ code: "oauth_nonce_mismatch" });
  });

  it("rejects callback scope when only the untrusted callback claims permission", async () => {
    const started = await auth.begin("learner-1");
    tokenNonce = requiredNonce(started.url);
    tokenScope = undefined;

    await expect(
      auth.complete(
        new URLSearchParams({
          code: "code-1",
          state: started.state,
          client_id: callbackClientId,
          scope: "chatgpt.tokens.use.direct",
        }),
      ),
    ).rejects.toMatchObject({ code: "oauth_scope_missing" });
  });

  it.each([
    ["expiration", { claims: { sub: "account-1" }, nonce: "valid", expiration: false }],
    ["subject", { claims: {}, nonce: "valid", expiration: true }],
    ["nonce", { claims: { sub: "account-1" }, nonce: undefined, expiration: true }],
  ])("rejects an initial ID token without %s", async (_claim, identity) => {
    const started = await auth.begin("learner-1");
    tokenClaims = identity.claims;
    tokenNonce = identity.nonce === "valid" ? requiredNonce(started.url) : undefined;
    includeExpiration = identity.expiration;

    await expect(
      auth.complete(
        new URLSearchParams({ code: "code-1", state: started.state, client_id: callbackClientId }),
      ),
    ).rejects.toBeDefined();
  });

  it("rejects nonce, client, and returning-account mismatches", async () => {
    const started = await auth.begin("learner-1");
    tokenNonce = requiredNonce(started.url);
    await auth.complete(
      new URLSearchParams({ code: "code-1", state: started.state, client_id: callbackClientId }),
    );

    const connected = await auth.begin("learner-1");
    tokenNonce = requiredNonce(connected.url);
    await expect(
      auth.complete(
        new URLSearchParams({ code: "code-2", state: connected.state, client_id: "oaiapp_wrong" }),
      ),
    ).rejects.toMatchObject({ code: "oauth_client_mismatch" });
    tokenClaims = { sub: "account-2" };
    const returning = await auth.begin("learner-1");
    tokenNonce = requiredNonce(returning.url);
    await expect(
      auth.complete(new URLSearchParams({ code: "code-3", state: returning.state })),
    ).rejects.toMatchObject({ code: "oauth_account_mismatch" });
  });

  it("rotates an expired refresh token and disconnect removes the grant", async () => {
    const started = await auth.begin("learner-1");
    tokenNonce = requiredNonce(started.url);
    await auth.complete(
      new URLSearchParams({ code: "code-1", state: started.state, client_id: callbackClientId }),
    );
    now += 3_700_000;
    tokenRefresh = "refresh-2";
    tokenNonce = undefined;

    const credential = await auth.credential("learner-1");
    expect((await tokenStore.read("learner-1"))?.refreshToken).toBe("refresh-2");
    await auth.disconnect("learner-1");

    expect(credential.accessToken).toBe("access-1");
    expect(await auth.status("learner-1")).toMatchObject({ connected: false });
  });

  it("rejects a refreshed ID token for another subject without replacing credentials", async () => {
    const started = await auth.begin("learner-1");
    tokenNonce = requiredNonce(started.url);
    await auth.complete(
      new URLSearchParams({ code: "code-1", state: started.state, client_id: callbackClientId }),
    );
    const original = await tokenStore.read("learner-1");
    now += 3_700_000;
    tokenClaims = { sub: "account-2" };
    tokenNonce = undefined;
    tokenRefresh = "refresh-2";

    await expect(auth.credential("learner-1")).rejects.toBeDefined();

    expect(await tokenStore.read("learner-1")).toEqual(original);
  });

  it("lists only account-visible models and persists an available selection", async () => {
    const started = await auth.begin("learner-1");
    tokenNonce = requiredNonce(started.url);
    await auth.complete(
      new URLSearchParams({ code: "code-1", state: started.state, client_id: callbackClientId }),
    );

    expect(await auth.models("learner-1")).toEqual([
      { slug: "gpt-listed", displayName: "GPT Listed" },
    ]);
    await auth.selectModel("learner-1", "gpt-listed");

    expect(await auth.responseCredential("learner-1")).toMatchObject({ model: "gpt-listed" });
    await expect(auth.selectModel("learner-1", "gpt-hidden")).rejects.toMatchObject({
      code: "chatgpt_model_unavailable",
    });
  });

  function baseUrl(): string {
    return `http://127.0.0.1:${port}`;
  }
});

function requiredNonce(url: string): string {
  const nonce = new URL(url).searchParams.get("nonce");
  if (nonce === null) throw new Error("authorization URL omitted nonce");
  return nonce;
}
