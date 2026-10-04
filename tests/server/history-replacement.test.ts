import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import { createTutorTestContext, learnerMessage } from "./tutor-test-fixtures.js";

describe("immutable history replacement", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it.each([
    "message_events",
    "thread_events",
    "thread_question_events",
    "thread_conversations",
    "knowledge_revisions",
    "evidence",
    "corrections",
    "knowledge_relations",
  ])("blocks replacement through the database connection for %s", (table) => {
    const context = createTutorTestContext(databases, "FSM", "FSM");
    const unit = z
      .object({ item: z.object({ id: z.string() }), revision: z.object({ id: z.string() }) })
      .parse(
        context.knowledge.create(context.owner, {
          title: "FSM",
          statement: "Finite states",
          riskScope: "stable",
          confidence: 0.5,
        }),
      );
    const messageId = learnerMessage(context, "FSM");
    const thread = context.core.createThread(context.owner, {
      title: "FSM",
      goal: "FSM",
      conversationId: context.conversationId,
    });
    context.core.addThreadQuestion(context.owner, thread.id, "Why finite?");
    context.knowledge.addEvidence(context.owner, {
      knowledgeId: unit.item.id,
      knowledgeRevisionId: unit.revision.id,
      revision: 1,
      conversationId: context.conversationId,
      messageId,
      dimension: "explanation",
      evidenceType: "free_explanation",
      score: 1,
      polarity: "positive",
      strength: 1,
      evaluatorConfidence: 1,
      evaluator: { type: "rule", rubricVersion: "test" },
      assistance: {
        hints: 0,
        answerVisible: false,
        openBook: false,
        copiedFromRecentContext: false,
      },
      supportingSpans: [],
      limitations: [],
      relatedUnitIds: [],
    });
    context.knowledge.correct(context.owner, {
      knowledgeId: unit.item.id,
      revision: 1,
      statement: "Not certain",
      reason: "Self report",
      kind: "claim_less",
      evidenceIds: [],
      targetType: "knowledge",
    });
    context.database.run("INSERT INTO knowledge_relations VALUES(?,?,?,?,?,?,?,?,?,?)", [
      crypto.randomUUID(),
      context.owner,
      unit.item.id,
      unit.item.id,
      "relatedness",
      unit.revision.id,
      unit.revision.id,
      null,
      null,
      new Date().toISOString(),
    ]);
    expect(() =>
      context.database.run(`INSERT OR REPLACE INTO ${table} SELECT * FROM ${table}`),
    ).toThrow(/immutable/);
  });
});
