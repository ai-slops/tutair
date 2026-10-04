import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { compress } from "hono/compress";
import { createApp } from "../../dist/server/app.js";
import { createProvider } from "../../dist/server/provider.js";

if (process.env.TUTOR_E2E_SERVER !== "1")
  throw new Error("This server is only for isolated browser tests");
const demo = createProvider({ TUTOR_PROVIDER: "demo", TUTOR_EMBEDDING_PROVIDER: "disabled" });
let failEvaluation = false;
const { app, database } = createApp({
  databasePath: ":memory:",
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
app.get("/assets/*", serveStatic({ root: "./dist/client" }));
app.get("/favicon.svg", serveStatic({ root: "./dist/client" }));
app.get("/favicon.ico", (context) => context.body(null, 204));
app.get("/model-setup.html", serveStatic({ root: "./dist/client" }));
app.get("/", serveStatic({ path: "./dist/client/index.html" }));
const server = serve({
  fetch: app.fetch,
  hostname: "127.0.0.1",
  port: Number(process.env.TUTOR_E2E_PORT),
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => server.close(() => database.close()));
