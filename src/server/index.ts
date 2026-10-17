import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { serve } from "@hono/node-server";
import { serveStatic } from "@hono/node-server/serve-static";
import { compress } from "hono/compress";
import { secureHeaders } from "hono/secure-headers";
import { z } from "zod";
import { createApp } from "./app.js";

const config = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    HOST: z.string().min(1).optional(),
    TUTOR_DB_PATH: z.string().min(1).optional(),
    DIM_DEVELOPMENT_URL_SOCKET: z.string().optional(),
    TUTOR_INGRESS: z.string().default("https-ts"),
  })
  .parse(process.env);

const databasePath =
  config.TUTOR_DB_PATH ?? join(homedir(), ".local", "share", "tutair", "tutair.sqlite");
mkdirSync(dirname(databasePath), { recursive: true, mode: 0o700 });

const { app, database, runtime, ready } = createApp({ databasePath });
await ready;
app.use(
  "*",
  secureHeaders({
    contentSecurityPolicy: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:"],
      connectSrc: ["'self'"],
      objectSrc: ["'none'"],
      baseUri: ["'self'"],
      frameAncestors: ["'none'"],
    },
    referrerPolicy: "no-referrer",
  }),
);
app.use("/assets/*", compress());
app.use("/assets/*", async (context, next) => {
  await next();
  context.header("Cache-Control", "public, max-age=31536000, immutable");
});
app.get("/assets/*", serveStatic({ root: "./dist/client" }));
app.get("/favicon.svg", serveStatic({ root: "./dist/client" }));
app.get("/favicon.ico", (c) => c.body(null, 204));
app.get("/model-setup.html", serveStatic({ root: "./dist/client" }));
app.get("/", serveStatic({ path: "./dist/client/index.html" }));

const server = serve(
  {
    fetch: app.fetch,
    port: config.PORT,
    hostname: config.HOST ?? "127.0.0.1",
  },
  (info) => {
    console.info(JSON.stringify({ event: "server.ready", port: info.port }));
    if (config.DIM_DEVELOPMENT_URL_SOCKET) {
      const exposed = spawnSync(
        "dim-development-service",
        [
          "expose",
          "--name",
          "tutair",
          "--port",
          String(info.port),
          "--ingress",
          config.TUTOR_INGRESS,
          "--require-scheme",
          "https",
        ],
        { encoding: "utf8" },
      );
      if (exposed.status === 0) {
        console.info(JSON.stringify({ event: "server.exposed", url: exposed.stdout.trim() }));
      } else {
        console.error(JSON.stringify({ event: "server.exposure_failed", port: info.port }));
      }
    }
  },
);

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    const closed = new Promise<void>((resolve) => {
      server.close(() => resolve());
    });
    await Promise.all([closed, runtime.dispose()]);
    database.close();
    console.info(JSON.stringify({ event: "server.stopped" }));
  });
}
