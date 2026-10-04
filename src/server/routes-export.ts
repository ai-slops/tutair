import { Hono } from "hono";
import { ownerFor, type Services } from "./context.js";
import { projectionVersion } from "./learner-projection.js";
import { genericRecord } from "./records.js";
import { isoNow } from "./types.js";

export const exportRoutes = (services: Services): Hono => {
  const app = new Hono();
  app.get("/export", (c) => {
    const owner = ownerFor(c, services);
    c.header("Content-Disposition", 'attachment; filename="tutair-learning-export.json"');
    const owned = (table: string) =>
      services.db.all(`SELECT * FROM ${table} WHERE learner_id=?`, [owner], genericRecord);
    const knowledge = services.knowledge.list(owner);
    return c.json({
      exportedAt: isoNow(),
      projectionVersion,
      learner: services.core.learner(owner),
      conversations: services.core.conversations(owner),
      messages: owned("messages"),
      messageEvents: owned("message_events"),
      threads: services.core.threads(owner),
      threadConversations: owned("thread_conversations"),
      threadEvents: owned("thread_events"),
      currentThreads: owned("current_threads"),
      openQuestions: owned("open_questions"),
      threadQuestionEvents: owned("thread_question_events"),
      knowledge,
      revisions: services.db.all(
        "SELECT r.* FROM knowledge_revisions r JOIN knowledge_items k ON k.id=r.knowledge_id WHERE k.learner_id IS NULL OR k.learner_id=? ORDER BY r.knowledge_id,r.revision",
        [owner],
        genericRecord,
      ),
      relations: services.db.all(
        "SELECT * FROM knowledge_relations WHERE learner_id IS NULL OR learner_id=? ORDER BY created_at,id",
        [owner],
        genericRecord,
      ),
      assessments: owned("assessments"),
      evidence: owned("evidence"),
      evidenceInvalidations: owned("evidence_invalidations"),
      exposures: owned("exposures"),
      learnerState: owned("learner_state"),
      corrections: owned("corrections"),
      qualityObservations: owned("quality_observations"),
      modelRuns: owned("model_runs"),
      modelRunDetails: services.db.all(
        "SELECT d.* FROM model_run_details d JOIN model_runs r ON r.id=d.run_id WHERE r.learner_id=?",
        [owner],
        genericRecord,
      ),
      modelRunContexts: services.db.all(
        "SELECT c.* FROM model_run_contexts c JOIN model_runs r ON r.id=c.run_id WHERE c.learner_id=? AND r.learner_id=? ORDER BY c.created_at,c.run_id",
        [owner, owner],
        genericRecord,
      ),
      traces: owned("traces"),
      turnPlans: owned("turn_plans"),
    });
  });
  return app;
};
