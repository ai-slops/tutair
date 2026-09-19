import type { Hono } from "hono";
import { z } from "zod";
import { jsonBody, ownerFor, type Services } from "./context.js";
import { correctionSchema, evidenceSchema, rebuildSchema } from "./schemas.js";

export const registerEvidenceRoutes = (app: Hono, services: Services): void => {
  app.get("/evidence", (c) => {
    const owner = ownerFor(c, services);
    const revision = c.req.query("revision");
    return c.json({
      evidence: services.knowledge.evidence(
        owner,
        c.req.query("knowledgeId"),
        revision === undefined ? undefined : z.coerce.number().int().positive().parse(revision),
      ),
    });
  });
  app.post("/evidence", async (c) => {
    const owner = ownerFor(c, services);
    const body = evidenceSchema.parse(await jsonBody(c));
    const revision = services.knowledge.revision(owner, body.knowledgeId, body.revision);
    const revisionId = z.object({ id: z.string() }).parse(revision).id;
    const message = services.core.message(owner, body.messageId);
    const conversationId = z.object({ conversation_id: z.string() }).parse(message).conversation_id;
    const assistance =
      typeof body.assistance === "string"
        ? {
            hints: body.assistance === "hint" ? 1 : 0,
            answerVisible: body.assistance === "worked_example",
            openBook: false,
            copiedFromRecentContext: body.copied,
          }
        : body.assistance;
    const evaluator =
      body.evaluator === undefined
        ? { type: "rule" as const, rubricVersion: "legacy-evidence-v1" }
        : {
            type: body.evaluator.type,
            rubricVersion: body.evaluator.rubricVersion,
            ...(body.evaluator.modelRunId === undefined
              ? {}
              : { modelRunId: body.evaluator.modelRunId }),
          };
    const evidence = services.knowledge.addEvidence(owner, {
      knowledgeId: body.knowledgeId,
      knowledgeRevisionId: body.knowledgeRevisionId ?? revisionId,
      revision: body.revision,
      conversationId: body.conversationId ?? conversationId,
      messageId: body.messageId,
      ...(body.messageEventId === undefined ? {} : { messageEventId: body.messageEventId }),
      ...(body.assessmentId === undefined ? {} : { assessmentId: body.assessmentId }),
      dimension: body.dimension,
      evidenceType: body.evidenceType,
      score:
        body.score ??
        (body.polarity === "positive" ? body.strength : Math.max(0, 1 - body.strength)),
      polarity: body.ambiguous ? "ambiguous" : body.polarity,
      strength: body.strength,
      evaluatorConfidence: body.evaluatorConfidence ?? body.confidence ?? 0.75,
      evaluator,
      assistance,
      supportingSpans: body.supportingSpans,
      limitations: body.limitations,
      relatedUnitIds: body.relatedUnitIds,
      ...(body.threadId === undefined ? {} : { threadId: body.threadId }),
      ...(body.difficulty === undefined ? {} : { difficulty: body.difficulty }),
      contextDiscount: body.contextDiscount,
    });
    return c.json({ evidence }, 201);
  });
  app.post("/evidence/rebuild", async (c) => {
    const owner = ownerFor(c, services);
    const body = rebuildSchema.parse(await jsonBody(c));
    return c.json({ rebuilt: services.knowledge.rebuild(owner, body.knowledgeId) });
  });
  app.post("/corrections", async (c) => {
    const owner = ownerFor(c, services);
    const body = correctionSchema.parse(await jsonBody(c));
    return c.json(
      services.knowledge.correct(owner, {
        knowledgeId: body.knowledgeId,
        revision: body.revision,
        statement: body.statement,
        reason: body.reason,
        kind: body.kind,
        evidenceIds: body.evidenceIds,
        targetType: body.targetType,
        ...(body.messageId === undefined ? {} : { messageId: body.messageId }),
        ...(body.targetId === undefined ? {} : { targetId: body.targetId }),
      }),
      201,
    );
  });
};
