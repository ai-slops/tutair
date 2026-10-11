import { createHash } from "node:crypto";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createApp } from "../../src/server/app.js";
import { ChatGptAuth } from "../../src/server/chatgpt-auth.js";
import { ProtectedTokenStore } from "../../src/server/chatgpt-token-store.js";

const EXTERNAL_ORIGIN = "https://tutair.example";
const CALLBACK = "http://127.0.0.1:1455/auth/callback";

describe("remote manual ChatGPT callback relay", () => {
  let oauth: Server;
  let oauthOrigin = "";
  let nonce = "";
  let challenge = "";
  let issuedCode = "";
  let now = Date.now();
  let app: ReturnType<typeof createApp>["app"];
  let closeDatabase: () => void;

  beforeEach(async () => {
    const keys = await generateKeyPair("RS256");
    const jwk = { ...(await exportJWK(keys.publicKey)), kid: "manual-fixture", alg: "RS256" };
    oauth = createServer(async (request, response) => {
      const url = new URL(request.url ?? "/", oauthOrigin);
      if (url.pathname === "/authorize") {
        expect(url.searchParams.get("redirect_uri")).toBe(CALLBACK);
        expect(url.searchParams.get("code_challenge_method")).toBe("S256");
        nonce = required(url.searchParams, "nonce");
        challenge = required(url.searchParams, "code_challenge");
        issuedCode = crypto.randomUUID();
        const callback = new URL(CALLBACK);
        callback.searchParams.set("code", issuedCode);
        callback.searchParams.set("state", required(url.searchParams, "state"));
        callback.searchParams.set("client_id", "oaiapp_manual_fixture");
        response.writeHead(302, { location: callback.toString() });
        response.end();
        return;
      }
      if (url.pathname === "/token") {
        const body: Buffer[] = [];
        for await (const chunk of request)
          body.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        const form = new URLSearchParams(Buffer.concat(body).toString("utf8"));
        expect(form.get("code")).toBe(issuedCode);
        expect(form.get("redirect_uri")).toBe(CALLBACK);
        expect(
          createHash("sha256").update(required(form, "code_verifier")).digest("base64url"),
        ).toBe(challenge);
        const idToken = await new SignJWT({ sub: "manual-account", nonce })
          .setProtectedHeader({ alg: "RS256", kid: "manual-fixture" })
          .setIssuer(oauthOrigin)
          .setAudience(required(form, "client_id"))
          .setIssuedAt()
          .setExpirationTime("5m")
          .sign(keys.privateKey);
        response.setHeader("content-type", "application/json");
        response.end(
          JSON.stringify({
            access_token: "manual-access",
            refresh_token: "manual-refresh",
            id_token: idToken,
            expires_in: 3600,
            scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
            token_type: "Bearer",
          }),
        );
        return;
      }
      if (url.pathname === "/jwks") {
        response.setHeader("content-type", "application/json");
        response.end(JSON.stringify({ keys: [jwk] }));
        return;
      }
      response.statusCode = 404;
      response.end();
    });
    await new Promise<void>((resolve) => oauth.listen(0, "127.0.0.1", resolve));
    const address = oauth.address();
    if (address === null || typeof address === "string")
      throw new Error("OAuth fixture did not bind");
    oauthOrigin = `http://127.0.0.1:${address.port}`;
    const auth = new ChatGptAuth({
      enabled: true,
      callbackPort: 1455,
      authorizationUrl: `${oauthOrigin}/authorize`,
      tokenUrl: `${oauthOrigin}/token`,
      jwksUrl: `${oauthOrigin}/jwks`,
      issuer: oauthOrigin,
      apiBaseUrl: oauthOrigin,
      manualCallback: true,
      manualOrigins: [EXTERNAL_ORIGIN],
      now: () => now,
      store: new ProtectedTokenStore(join(tmpdir(), `tutair-manual-${crypto.randomUUID()}.json`)),
    });
    const created = createApp({
      databasePath: ":memory:",
      env: { TUTOR_PROVIDER: "demo", TUTOR_EMBEDDING_PROVIDER: "disabled" },
      chatgptAuth: auth,
    });
    app = created.app;
    closeDatabase = () => created.database.close();
  });

  afterEach(async () => {
    closeDatabase();
    await new Promise<void>((resolve, reject) =>
      oauth.close((error) => (error === undefined ? resolve() : reject(error))),
    );
  });

  it("completes the issued authorization response for its initiating learner", async () => {
    const learner = await signup(app, "Learner A");

    const callbackUrl = await beginAuthorization(learner.cookie);
    const completed = await submitCallback(app, learner.cookie, callbackUrl);

    expect(completed.status).toBe(200);
    expect(await completed.json()).toMatchObject({ connected: true, subject: "manual-account" });
  });

  it("does not let another learner consume or invalidate a pending callback", async () => {
    const learnerA = await signup(app, "Learner A");
    const learnerB = await signup(app, "Learner B");
    const callbackUrl = await beginAuthorization(learnerA.cookie);

    const stolen = await submitCallback(app, learnerB.cookie, callbackUrl);
    const legitimate = await submitCallback(app, learnerA.cookie, callbackUrl);

    expect(stolen.status).toBe(401);
    expect(await stolen.json()).toMatchObject({ error: { code: "oauth_state_invalid" } });
    expect(legitimate.status).toBe(200);
  });

  it.each([
    [
      "wrong callback",
      "https://attacker.example/auth/callback?state=x&code=y",
      "oauth_callback_invalid",
    ],
    ["missing state", `${CALLBACK}?code=issued`, "oauth_state_invalid"],
  ])("rejects %s", async (_case, callbackUrl, code) => {
    const learner = await signup(app, "Learner A");

    const response = await submitCallback(app, learner.cookie, callbackUrl);

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { code } });
  });

  it("rejects replay after a successful completion", async () => {
    const learner = await signup(app, "Learner A");
    const callbackUrl = await beginAuthorization(learner.cookie);
    expect((await submitCallback(app, learner.cookie, callbackUrl)).status).toBe(200);

    const replay = await submitCallback(app, learner.cookie, callbackUrl);

    expect(replay.status).toBe(401);
    expect(await replay.json()).toMatchObject({ error: { code: "oauth_state_invalid" } });
  });

  it("handles denial for its owner and rejects replay of the denied state", async () => {
    const learner = await signup(app, "Learner A");
    const callback = new URL(await beginAuthorization(learner.cookie));
    callback.searchParams.delete("code");
    callback.searchParams.set("error", "access_denied");

    const denied = await submitCallback(app, learner.cookie, callback.toString());
    const replay = await submitCallback(app, learner.cookie, callback.toString());

    expect(await denied.json()).toMatchObject({ error: { code: "oauth_access_denied" } });
    expect(await replay.json()).toMatchObject({ error: { code: "oauth_state_invalid" } });
  });

  it("rejects an expired callback", async () => {
    const learner = await signup(app, "Learner A");
    const callbackUrl = await beginAuthorization(learner.cookie);
    now += 600_001;

    const expired = await submitCallback(app, learner.cookie, callbackUrl);

    expect(await expired.json()).toMatchObject({ error: { code: "oauth_state_invalid" } });
  });

  async function beginAuthorization(cookie: string): Promise<string> {
    const response = await app.request(`${EXTERNAL_ORIGIN}/api/chatgpt/manual/authorize`, {
      method: "POST",
      headers: { cookie, origin: EXTERNAL_ORIGIN },
    });
    expect(response.status).toBe(200);
    const { authorizationUrl } = z
      .object({ authorizationUrl: z.url() })
      .parse(await response.json());
    const authorized = await fetch(authorizationUrl, { redirect: "manual" });
    const callbackUrl = authorized.headers.get("location");
    if (callbackUrl === null) throw new Error("OAuth fixture omitted callback URL");
    return callbackUrl;
  }
});

async function signup(app: ReturnType<typeof createApp>["app"], displayName: string) {
  const response = await app.request(`${EXTERNAL_ORIGIN}/api/auth/local-signup`, {
    method: "POST",
    headers: { origin: EXTERNAL_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ displayName }),
  });
  const cookie = response.headers.get("set-cookie")?.split(";")[0];
  if (cookie === undefined) throw new Error("Signup omitted cookie");
  return { cookie };
}

async function submitCallback(
  app: ReturnType<typeof createApp>["app"],
  cookie: string,
  callbackUrl: string,
): Promise<Response> {
  return await app.request(`${EXTERNAL_ORIGIN}/api/chatgpt/manual/callback`, {
    method: "POST",
    headers: { cookie, origin: EXTERNAL_ORIGIN, "content-type": "application/json" },
    body: JSON.stringify({ callbackUrl }),
  });
}

function required(params: URLSearchParams, key: string): string {
  const value = params.get(key);
  if (value === null) throw new Error(`Missing fixture parameter: ${key}`);
  return value;
}
