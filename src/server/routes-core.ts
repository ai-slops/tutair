import { Hono } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { jsonBody, ownerFor, type Services } from "./context.js";
import { genericRecord } from "./records.js";
import { registerConversationRoutes } from "./routes-conversations.js";
import { resumeSchema, signupSchema, threadCreateSchema, threadUpdateSchema } from "./schemas.js";
import { isoNow, newId } from "./types.js";

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
  app.get("/capabilities", (c) =>
    c.json({
      provider: services.provider.state.provider,
      outputMode: services.provider.state.outputMode ?? null,
      model: services.provider.state.model,
      generation: services.provider.state.generation,
      embedding: services.provider.state.embedding === "configured",
      search: true,
      searchMode: services.provider.state.embedding === "configured" ? "hybrid" : "fts-only",
      synthetic: services.provider.state.synthetic,
    }),
  );
  registerConversationRoutes(app, services);
  app.get("/threads", (c) => c.json({ threads: services.core.threads(ownerFor(c, services)) }));
  app.post("/threads", async (c) => {
    const owner = ownerFor(c, services);
    return c.json(
      { thread: services.core.createThread(owner, threadCreateSchema.parse(await jsonBody(c))) },
      201,
    );
  });
  app.get("/threads/:id", (c) => {
    const owner = ownerFor(c, services);
    const thread = services.core.thread(owner, c.req.param("id"));
    const id = z.object({ id: z.string() }).parse(thread).id;
    return c.json({
      thread,
      events: services.db.all(
        "SELECT * FROM thread_events WHERE learner_id=? AND thread_id=? ORDER BY created_at",
        [owner, id],
        genericRecord,
      ),
      openQuestions: services.db.all(
        "SELECT * FROM open_questions WHERE learner_id=? AND thread_id=? ORDER BY created_at",
        [owner, id],
        genericRecord,
      ),
      conversations: services.db.all(
        "SELECT c.* FROM conversations c JOIN thread_conversations tc ON tc.conversation_id=c.id WHERE tc.learner_id=? AND tc.thread_id=? ORDER BY tc.linked_at",
        [owner, id],
        genericRecord,
      ),
    });
  });
  app.patch("/threads/:id", async (c) => {
    const owner = ownerFor(c, services);
    const prior = services.core.thread(owner, c.req.param("id"));
    const row = z
      .object({ id: z.string(), title: z.string(), goal: z.string(), status: z.string() })
      .parse(prior);
    const body = threadUpdateSchema.parse(await jsonBody(c));
    const now = isoNow();
    services.db.run(
      "UPDATE threads SET title=?,goal=?,status=?,updated_at=? WHERE id=? AND learner_id=?",
      [
        body.title ?? row.title,
        body.goal ?? row.goal,
        body.status ?? row.status,
        now,
        row.id,
        owner,
      ],
    );
    services.db.run("INSERT INTO thread_events VALUES(?,?,?,?,?,?)", [
      newId(),
      row.id,
      owner,
      "updated",
      JSON.stringify(body),
      now,
    ]);
    return c.json({ thread: services.core.thread(owner, row.id) });
  });
  app.post("/threads/:id/resume", async (c) => {
    const owner = ownerFor(c, services);
    const thread = z
      .object({
        id: z.string(),
        title: z.string(),
        goal: z.string(),
        conversation_id: z.string().nullable(),
      })
      .parse(services.core.thread(owner, c.req.param("id")));
    const body = resumeSchema.parse(await jsonBody(c));
    const conversation =
      body.conversationId === undefined
        ? services.core.createConversation(owner, thread.title, thread.goal)
        : services.core.conversation(owner, body.conversationId);
    const conversationId = z.object({ id: z.string() }).parse(conversation).id;
    const now = isoNow();
    services.db.transaction(() => {
      services.db.run(
        "UPDATE threads SET conversation_id=?,status='open',updated_at=? WHERE id=? AND learner_id=?",
        [conversationId, now, thread.id, owner],
      );
      services.db.run("INSERT OR IGNORE INTO thread_conversations VALUES(?,?,?,?)", [
        thread.id,
        conversationId,
        owner,
        now,
      ]);
      services.db.run("INSERT INTO thread_events VALUES(?,?,?,?,?,?)", [
        newId(),
        thread.id,
        owner,
        "resumed",
        JSON.stringify({ conversationId }),
        now,
      ]);
    });
    return c.json({ thread: services.core.thread(owner, thread.id), conversation });
  });
  app.delete("/privacy", (c) => {
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
    return c.body(null, 204);
  });
  return app;
};
