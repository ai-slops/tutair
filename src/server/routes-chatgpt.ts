import { Hono } from "hono";
import { z } from "zod";
import { jsonBody, ownerFor, type Services } from "./context.js";
import { ApiError } from "./types.js";

export const chatGptRoutes = (services: Services): Hono => {
  const app = new Hono();
  app.get("/chatgpt/status", async (c) => {
    const owner = ownerFor(c, services);
    return c.json(await requiredAuth(services).status(owner));
  });
  app.get("/chatgpt/connect", async (c) => {
    assertLocalBridge(c.req.url, c.req.header("origin"));
    const owner = ownerFor(c, services);
    const started = await requiredAuth(services).begin(owner);
    return c.redirect(started.url, 302);
  });
  app.post("/chatgpt/manual/authorize", async (c) => {
    const auth = requiredAuth(services);
    auth.assertManualOrigin(c.req.header("origin"));
    const started = await auth.begin(ownerFor(c, services));
    return c.redirect(started.url, 302);
  });
  app.post("/chatgpt/manual/callback", async (c) => {
    const auth = requiredAuth(services);
    auth.assertManualOrigin(c.req.header("origin"));
    const body = z.object({ callbackUrl: z.url().max(8_192) }).parse(await jsonBody(c));
    const owner = ownerFor(c, services);
    await auth.completeManual(owner, body.callbackUrl);
    return c.json(await auth.status(owner));
  });
  app.delete("/chatgpt/connection", async (c) => {
    const owner = ownerFor(c, services);
    await requiredAuth(services).disconnect(owner);
    return c.body(null, 204);
  });
  app.get("/chatgpt/models", async (c) => {
    const owner = ownerFor(c, services);
    return c.json({ models: await requiredAuth(services).models(owner) });
  });
  app.put("/chatgpt/model", async (c) => {
    const owner = ownerFor(c, services);
    const body = z.object({ slug: z.string().min(1) }).parse(await jsonBody(c));
    await requiredAuth(services).selectModel(owner, body.slug);
    return c.body(null, 204);
  });
  return app;
};

export function assertLocalBridge(requestUrl: string, origin: string | undefined): void {
  const request = new URL(requestUrl);
  if (!isLoopback(request.hostname))
    throw new ApiError(
      403,
      "local_bridge_required",
      "ChatGPT connection must start through a loopback URL",
    );
  if (origin !== undefined) {
    const source = new URL(origin);
    if (!isLoopback(source.hostname) || source.host !== request.host)
      throw new ApiError(403, "local_bridge_required", "Loopback origin did not match this server");
  }
}

function requiredAuth(services: Services) {
  if (services.chatgptAuth === null || services.chatgptAuth === undefined)
    throw new ApiError(404, "chatgpt_personal_disabled", "Personal ChatGPT mode is disabled");
  return services.chatgptAuth;
}

function isLoopback(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "[::1]" || hostname === "::1";
}
