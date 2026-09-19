import type { Hono } from "hono";
import { z } from "zod";
import { jsonBody, ownerFor, type Services } from "./context.js";
import { genericRecord } from "./records.js";
import { conversationSchema, messageSchema, tutorTurnSchema } from "./schemas.js";
import { ApiError } from "./types.js";

const blockedRecord = z.object({ blocked: z.number() });

export const registerConversationRoutes = (app: Hono, services: Services): void => {
  app.get("/conversations", (c) =>
    c.json({ conversations: services.core.conversations(ownerFor(c, services)) }),
  );
  app.post("/conversations", async (c) => {
    const owner = ownerFor(c, services);
    const body = conversationSchema.parse(await jsonBody(c));
    return c.json(
      {
        conversation: services.core.createConversation(
          owner,
          body.title ?? "New learning session",
          body.goal ?? null,
        ),
      },
      201,
    );
  });
  app.get("/conversations/:id", (c) => {
    const owner = ownerFor(c, services);
    const id = c.req.param("id");
    return c.json({
      conversation: services.core.conversation(owner, id),
      messages: services.core.messages(owner, id),
      threads: services.db.all(
        "SELECT t.* FROM threads t JOIN thread_conversations tc ON tc.thread_id=t.id WHERE tc.learner_id=? AND tc.conversation_id=? ORDER BY t.updated_at DESC",
        [owner, id],
        genericRecord,
      ),
    });
  });
  app.delete("/conversations/:id", (c) => {
    const owner = ownerFor(c, services);
    const id = c.req.param("id");
    services.core.conversation(owner, id);
    const blocked = services.db.one(
      `SELECT 1 AS blocked WHERE
       EXISTS(SELECT 1 FROM messages WHERE learner_id=? AND conversation_id=?) OR
       EXISTS(SELECT 1 FROM model_runs WHERE learner_id=? AND conversation_id=?) OR
       EXISTS(SELECT 1 FROM knowledge_revisions r JOIN knowledge_items k ON k.id=r.knowledge_id WHERE r.conversation_id=? AND k.learner_id=?) OR
       EXISTS(SELECT 1 FROM assessments WHERE learner_id=? AND conversation_id=?) OR
       EXISTS(SELECT 1 FROM turn_plans WHERE learner_id=? AND conversation_id=?) OR
       EXISTS(SELECT 1 FROM thread_conversations WHERE learner_id=? AND conversation_id=?)`,
      [owner, id, owner, id, id, owner, owner, id, owner, id, owner, id],
      blockedRecord,
    );
    if (blocked !== null)
      throw new ApiError(
        409,
        "conversation_has_provenance",
        "Conversation with preserved history cannot be deleted; erase private data instead",
      );
    services.db.run("DELETE FROM conversations WHERE id=? AND learner_id=?", [id, owner]);
    return c.body(null, 204);
  });
  app.post("/conversations/:id/messages", async (c) => {
    const owner = ownerFor(c, services);
    const body = messageSchema.parse(await jsonBody(c));
    return c.json(
      { message: services.core.createMessage(owner, c.req.param("id"), "learner", body.content) },
      201,
    );
  });
  app.patch("/conversations/:id/messages/:messageId", async (c) => {
    const owner = ownerFor(c, services);
    const body = messageSchema.parse(await jsonBody(c));
    return c.json({
      message: services.core.editMessage(
        owner,
        c.req.param("id"),
        c.req.param("messageId"),
        body.content,
      ),
    });
  });
  app.delete("/conversations/:id/messages/:messageId", (c) => {
    services.core.tombstone(ownerFor(c, services), c.req.param("id"), c.req.param("messageId"));
    return c.body(null, 204);
  });
  app.post("/conversations/:id/tutor-turn", async (c) => {
    const owner = ownerFor(c, services);
    const conversationId = c.req.param("id");
    services.core.conversation(owner, conversationId);
    const cutoff = Date.now() - 60_000;
    const attempts = (services.turnAttempts.get(owner) ?? []).filter((time) => time > cutoff);
    if (attempts.length >= 20)
      throw new ApiError(429, "rate_limited", "Tutor turn rate limit exceeded");
    attempts.push(Date.now());
    services.turnAttempts.set(owner, attempts);
    const body = tutorTurnSchema.parse(await jsonBody(c));
    const lock = `${owner}:${conversationId}`;
    if (services.turnLocks.has(lock))
      throw new ApiError(409, "turn_in_progress", "A tutor turn is already running");
    services.turnLocks.add(lock);
    try {
      const userMessage = services.core.createMessage(
        owner,
        conversationId,
        "learner",
        body.content,
      );
      const messageId = z.object({ id: z.string() }).parse(userMessage).id;
      try {
        const result = await services.tutor.turn({ owner, conversationId, messageId, ...body });
        return c.json(
          { userMessage, ...result, synthetic: services.provider.state.synthetic },
          201,
        );
      } catch (error) {
        if (error instanceof ApiError)
          throw new ApiError(error.status, error.code, error.message, {
            ...error.details,
            userMessageId: messageId,
          });
        throw new ApiError(500, "tutor_turn_failed", "Tutor turn failed after saving input", {
          userMessageId: messageId,
        });
      }
    } finally {
      services.turnLocks.delete(lock);
    }
  });
};
