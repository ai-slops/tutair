import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { jsonBody, ownerFor, type Services } from "./context.js";
import { registerConversationRoutes } from "./routes-conversations.js";
import { registerThreadRoutes } from "./routes-threads.js";
import { signupSchema } from "./schemas.js";

export const coreRoutes = (services: Services): Hono => {
  const app = new Hono();
  app.post("/auth/local-signup", async (c) => {
    const body = signupSchema.parse(await jsonBody(c));
    const result = services.core.signup(body.displayName ?? "Local learner");
    setCookie(c, "tutor_session", result.token, {
      httpOnly: true,
      sameSite: "Strict",
      secure: c.req.url.startsWith("https:"),
      path: "/",
      maxAge: 31_536_000,
    });
    return c.json({ learner: result.learner, synthetic: false }, 201);
  });
  app.get("/session", (c) => c.json({ learner: services.core.learner(ownerFor(c, services)) }));
  app.get("/capabilities", async (c) => {
    const owner = ownerFor(c, services);
    return c.json({
      provider: services.provider.state.provider,
      outputMode: services.provider.state.outputMode ?? null,
      model: services.provider.state.model,
      generation: services.provider.state.generation,
      embedding: services.provider.state.embedding === "configured",
      search: true,
      searchMode: services.provider.state.embedding === "configured" ? "hybrid" : "fts-only",
      synthetic: services.provider.state.synthetic,
      chatgpt:
        services.chatgptAuth === null || services.chatgptAuth === undefined
          ? { enabled: false, connected: false }
          : await services.chatgptAuth.status(owner),
    });
  });
  registerConversationRoutes(app, services);
  registerThreadRoutes(app, services);
  app.delete("/privacy", async (c) => {
    const owner = ownerFor(c, services);
    services.db.transaction(() => {
      services.db.run("UPDATE privacy_mode SET active=1 WHERE singleton=1");
      services.db.run(
        "DELETE FROM knowledge_fts WHERE knowledge_id IN (SELECT id FROM knowledge_items WHERE learner_id=?)",
        [owner],
      );
      services.db.run("DELETE FROM embedding_cache WHERE learner_id=?", [owner]);
      services.db.run("DELETE FROM knowledge_items WHERE learner_id=?", [owner]);
      services.db.run("DELETE FROM learners WHERE id=?", [owner]);
      services.db.run("UPDATE privacy_mode SET active=0 WHERE singleton=1");
    });
    deleteCookie(c, "tutor_session", { path: "/" });
    await services.chatgptAuth?.disconnect(owner);
    return c.body(null, 204);
  });
  return app;
};
