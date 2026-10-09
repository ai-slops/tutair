import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { compress } from "hono/compress";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../dist/server/app.js";
import { ChatGptAuth } from "../../dist/server/chatgpt-auth.js";
import { ProtectedTokenStore } from "../../dist/server/chatgpt-token-store.js";
import { createProvider } from "../../dist/server/provider-factory.js";

if (process.env.TUTOR_E2E_SERVER !== "1")
  throw new Error("This server is only for isolated browser tests");
const demo = createProvider({ TUTOR_PROVIDER: "demo", TUTOR_EMBEDDING_PROVIDER: "disabled" });
const port = Number(process.env.TUTOR_E2E_PORT);
const tokenStore = new ProtectedTokenStore(
  join(tmpdir(), `tutair-browser-${crypto.randomUUID()}.json`),
);
const chatgptAuth = new ChatGptAuth({
  enabled: true,
  callbackPort: port,
  authorizationUrl: "https://auth.example/authorize",
  tokenUrl: "https://auth.example/token",
  jwksUrl: "https://auth.example/jwks",
  issuer: "https://auth.example",
  apiBaseUrl: `http://127.0.0.1:${port}/__openai`,
  store: tokenStore,
});
let failEvaluation = false;
const { app, database } = createApp({
  databasePath: ":memory:",
  chatgptAuth,
  provider: {
    state: demo.state,
    embeddingProfile: demo.embeddingProfile,
    async call(call) {
      if (failEvaluation && call.stage === "evaluation")
        throw new Error("Test evaluator unavailable");
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
app.post("/__test__/chatgpt", async (context) => {
  const body = await context.req.json();
  await tokenStore.write(body.learnerId, {
    clientId: "oaiapp_browser_fixture",
    issuer: "https://auth.example",
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
