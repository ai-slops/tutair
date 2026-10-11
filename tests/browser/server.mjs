import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { compress } from "hono/compress";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { createApp } from "../../dist/server/app.js";
import { ChatGptAuth } from "../../dist/server/chatgpt-auth.js";
import { ProtectedTokenStore } from "../../dist/server/chatgpt-token-store.js";
import { createProvider } from "../../dist/server/provider-factory.js";

if (process.env.TUTOR_E2E_SERVER !== "1")
  throw new Error("This server is only for isolated browser tests");
const demo = createProvider({ TUTOR_PROVIDER: "demo", TUTOR_EMBEDDING_PROVIDER: "disabled" });
const port = Number(process.env.TUTOR_E2E_PORT);
const origin = `http://127.0.0.1:${port}`;
const { privateKey, publicKey } = await generateKeyPair("RS256");
const publicJwk = { ...(await exportJWK(publicKey)), kid: "browser-fixture", use: "sig" };
const authorizations = new Map();
const tokenStore = new ProtectedTokenStore(
  join(tmpdir(), `tutair-browser-${crypto.randomUUID()}.json`),
);
const chatgptAuth = new ChatGptAuth({
  enabled: true,
  callbackPort: port,
  authorizationUrl: `${origin}/__oauth/authorize`,
  tokenUrl: `${origin}/__oauth/token`,
  jwksUrl: `${origin}/__oauth/jwks`,
  issuer: origin,
  apiBaseUrl: `http://127.0.0.1:${port}/__openai`,
  manualCallback: true,
  manualOrigins: [origin],
  store: tokenStore,
});
let failEvaluation = false;
let failStage = null;
let pausedStage = null;
let releasePausedStage = null;
let pausedStageGate = Promise.resolve();
const { app, database } = createApp({
  databasePath: ":memory:",
  chatgptAuth,
  provider: {
    state: demo.state,
    embeddingProfile: demo.embeddingProfile,
    async call(call) {
      if (failEvaluation && call.stage === "evaluation")
        throw new Error("Test evaluator unavailable");
      if (failStage === call.stage) throw new Error(`Test ${call.stage} unavailable`);
      if (pausedStage === call.stage) {
        pausedStage = null;
        await pausedStageGate;
      }
      return demo.call(call);
    },
  },
});
app.use("/assets/*", compress());
app.use("/assets/*", async (context, next) => {
  await next();
  context.header("Cache-Control", "public, max-age=31536000, immutable");
});
app.post("/__test__/evaluation", async (context) => {
  const body = await context.req.json();
  failEvaluation = body.fail === true;
  return context.json({ enabled: failEvaluation });
});
app.post("/__test__/generation", async (context) => {
  const body = await context.req.json();
  failStage = typeof body.failStage === "string" ? body.failStage : null;
  pausedStage = typeof body.pauseStage === "string" ? body.pauseStage : null;
  releasePausedStage?.();
  pausedStageGate =
    pausedStage === null
      ? Promise.resolve()
      : new Promise((resolve) => {
          releasePausedStage = resolve;
        });
  return context.json({ failStage, pausedStage });
});
app.post("/__test__/generation/release", (context) => {
  releasePausedStage?.();
  releasePausedStage = null;
  return context.body(null, 204);
});
app.post("/__test__/chatgpt", async (context) => {
  const body = await context.req.json();
  await tokenStore.write(body.learnerId, {
    clientId: "oaiapp_browser_fixture",
    issuer: origin,
    subject: "account-browser",
    scopes: ["chatgpt.tokens.use.direct"],
    accessToken: "browser-access-token",
    refreshToken: "browser-refresh-token",
    idToken: "browser-id-token",
    expiresAt: Date.now() + 3_600_000,
    selectedModel: "gpt-browser",
  });
  return context.body(null, 204);
});
app.get("/__oauth/authorize", (context) => {
  const requestUrl = new URL(context.req.url);
  const state = requestUrl.searchParams.get("state");
  const nonce = requestUrl.searchParams.get("nonce");
  const challenge = requestUrl.searchParams.get("code_challenge");
  if (state === null || nonce === null || challenge === null)
    return context.text("Invalid authorization request", 400);
  const code = crypto.randomUUID();
  authorizations.set(code, { challenge, nonce });
  const callback = new URL(`http://127.0.0.1:${port}/auth/callback`);
  callback.searchParams.set("code", code);
  callback.searchParams.set("state", state);
  callback.searchParams.set("client_id", "oaiapp_browser_fixture");
  return context.html(
    `<!doctype html><html lang="en"><head><title>OAuth fixture</title></head><body><main><h1>Authorization approved</h1><label>Callback URL<input aria-label="Callback URL" value="${callback.toString()}" readonly></label></main></body></html>`,
  );
});
app.post("/__oauth/token", async (context) => {
  const form = await context.req.parseBody();
  const code = form.code;
  const verifier = form.code_verifier;
  const authorization = typeof code === "string" ? authorizations.get(code) : undefined;
  if (
    authorization === undefined ||
    typeof verifier !== "string" ||
    createHash("sha256").update(verifier).digest("base64url") !== authorization.challenge
  )
    return context.json({ error: "invalid_grant" }, 400);
  authorizations.delete(code);
  const idToken = await new SignJWT({ sub: "account-browser", nonce: authorization.nonce })
    .setProtectedHeader({ alg: "RS256", kid: "browser-fixture" })
    .setIssuer(origin)
    .setAudience("oaiapp_browser_fixture")
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(privateKey);
  return context.json({
    access_token: "browser-access-token",
    refresh_token: "browser-refresh-token",
    id_token: idToken,
    expires_in: 3600,
    scope: "chatgpt.tokens.use.direct",
    token_type: "Bearer",
  });
});
app.get("/__oauth/jwks", (context) => context.json({ keys: [publicJwk] }));
app.get("/__openai/models", (context) =>
  context.json({
    models: [
      { slug: "gpt-browser", display_name: "GPT Browser", visibility: "list" },
      { slug: "gpt-hidden", display_name: "GPT Hidden", visibility: "hidden" },
    ],
  }),
);
app.get("/assets/*", serveStatic({ root: "./dist/client" }));
app.get("/favicon.svg", serveStatic({ root: "./dist/client" }));
app.get("/favicon.ico", (context) => context.body(null, 204));
app.get("/model-setup.html", serveStatic({ root: "./dist/client" }));
app.get("/", serveStatic({ path: "./dist/client/index.html" }));
const server = serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port,
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.close(() => database.close()));
