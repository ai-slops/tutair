import type { Hono } from "hono";
import { jsonBody, ownerFor, type Services } from "./context.js";
import { genericRecord } from "./records.js";
import {
  resumeSchema,
  threadCreateSchema,
  threadQuestionCreateSchema,
  threadQuestionUpdateSchema,
  threadUpdateSchema,
} from "./thread-schemas.js";

export const registerThreadRoutes = (app: Hono, services: Services): void => {
  app.get("/threads", (c) => c.json({ threads: services.core.threads(ownerFor(c, services)) }));
  app.post("/threads", async (c) => {
    const owner = ownerFor(c, services);
    const body = threadCreateSchema.parse(await jsonBody(c));
    return c.json({ thread: services.core.createThread(owner, body) }, 201);
  });
  app.get("/threads/:id", (c) => {
    const owner = ownerFor(c, services);
    const thread = services.core.thread(owner, c.req.param("id"));
    return c.json({
      thread,
      events: services.db.all(
        "SELECT * FROM thread_events WHERE learner_id=? AND thread_id=? ORDER BY created_at,id",
        [owner, thread.id],
        genericRecord,
      ),
      openQuestions: services.db.all(
        "SELECT * FROM open_questions WHERE learner_id=? AND thread_id=? ORDER BY created_at,id",
        [owner, thread.id],
        genericRecord,
      ),
      questionEvents: services.db.all(
        "SELECT * FROM thread_question_events WHERE learner_id=? AND thread_id=? ORDER BY created_at,id",
        [owner, thread.id],
        genericRecord,
      ),
      conversations: services.db.all(
        "SELECT c.* FROM conversations c JOIN thread_conversations tc ON tc.conversation_id=c.id WHERE tc.learner_id=? AND tc.thread_id=? ORDER BY tc.linked_at",
        [owner, thread.id],
        genericRecord,
      ),
    });
  });
  app.patch("/threads/:id", async (c) => {
    const owner = ownerFor(c, services);
    const body = threadUpdateSchema.parse(await jsonBody(c));
    return c.json({ thread: services.core.updateThread(owner, c.req.param("id"), body) });
  });
  app.post("/threads/:id/questions", async (c) => {
    const owner = ownerFor(c, services);
    const body = threadQuestionCreateSchema.parse(await jsonBody(c));
    return c.json(
      { question: services.core.addThreadQuestion(owner, c.req.param("id"), body.text) },
      201,
    );
  });
  app.patch("/threads/:id/questions/:questionId", async (c) => {
    const owner = ownerFor(c, services);
    const body = threadQuestionUpdateSchema.parse(await jsonBody(c));
    return c.json({
      question: services.core.updateThreadQuestion(
        owner,
        c.req.param("id"),
        c.req.param("questionId"),
        body.status,
      ),
    });
  });
  app.post("/threads/:id/resume", async (c) => {
    const owner = ownerFor(c, services);
    const thread = services.core.thread(owner, c.req.param("id"));
    const body = resumeSchema.parse(await jsonBody(c));
    const conversation =
      body.conversationId === undefined
        ? services.core.createConversation(owner, thread.title, thread.goal)
        : services.core.conversation(owner, body.conversationId);
    const conversationId = genericRecord.parse(conversation)["id"];
    if (typeof conversationId !== "string") throw new TypeError("Conversation ID must be text");
    return c.json({
      thread: services.core.selectThread(owner, conversationId, thread.id, "explicit_resume"),
      conversation,
    });
  });
};
