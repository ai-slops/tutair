import type { Hono } from "hono";
import { z } from "zod";
import { jsonBody, ownerFor, type Services } from "./context.js";
import { DebugSettingsStore } from "./debug-settings-store.js";

const debugSettingsSchema = z.object({ saveProviderReasoningSummaries: z.boolean() }).strict();

export function registerDebugSettingsRoutes(app: Hono, services: Services): void {
  const store = new DebugSettingsStore(services.db);
  app.get("/settings/debug", (context) => context.json(store.get(ownerFor(context, services))));
  app.put("/settings/debug", async (context) => {
    const owner = ownerFor(context, services);
    const body = debugSettingsSchema.parse(await jsonBody(context));
    return context.json(store.put(owner, body.saveProviderReasoningSummaries));
  });
}
