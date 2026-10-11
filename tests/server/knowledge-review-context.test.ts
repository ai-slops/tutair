import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import type { StructuredCall } from "../../src/server/provider.js";
import { TutorPipeline } from "../../src/server/tutor.js";
import {
  createTutorTestContext,
  learnerMessage,
  providerFor,
  type TutorTestContext,
} from "./tutor-test-fixtures.js";

const createUnit = (context: TutorTestContext) =>
  z.object({ item: z.object({ id: z.string() }), revision: z.object({ id: z.string() }) }).parse(
    context.knowledge.create(context.owner, {
      title: "Direct target",
      statement: "This definition must not reach generation.",
      riskScope: "stable",
      confidence: 0.8,
    }),
  );

describe("knowledge review context boundaries", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it("excludes an incorrect current revision from thread targets and every generation stage", async () => {
    // Given
    const calls: StructuredCall[] = [];
    const context = createTutorTestContext(databases, "Review", "Use direct target");
    const unit = createUnit(context);
    context.knowledge.review(context.owner, {
      knowledgeId: unit.item.id,
      revision: 1,
      action: "mark_incorrect",
      reason: "Known wrong fixture.",
      confirmed: false,
    });
    context.database.run(
      "UPDATE threads SET target_knowledge_unit_ids_json=? WHERE learner_id=? AND conversation_id=?",
      [JSON.stringify([unit.item.id]), context.owner, context.conversationId],
    );
    const content = "Use the direct target";

    // When
    await new TutorPipeline(
      context.database,
      context.core,
      context.knowledge,
      providerFor(undefined, calls),
    ).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId: learnerMessage(context, content),
      content,
      assistance: "none",
      selfReport: "neutral",
    });

    // Then
    const stages = calls.filter((call) =>
      ["evaluation", "planning", "draft", "lint", "final"].includes(call.stage),
    );
    expect(stages).toHaveLength(6);
    for (const call of stages) {
      const knowledge = z.array(z.object({ id: z.string() })).parse(call.data["knowledge"]);
      expect(knowledge.map((item) => item.id)).not.toContain(unit.item.id);
      expect(JSON.stringify(call.data)).not.toContain(unit.revision.id);
    }
  });

  it("makes a restored unit eligible for direct context again", () => {
    // Given
    const context = createTutorTestContext(databases, "Restore", "Restore target");
    const unit = createUnit(context);
    context.knowledge.review(context.owner, {
      knowledgeId: unit.item.id,
      revision: 1,
      action: "retire",
      reason: "Temporarily irrelevant.",
      confirmed: false,
    });

    // When
    context.knowledge.review(context.owner, {
      knowledgeId: unit.item.id,
      revision: 1,
      action: "restore",
      reason: null,
      confirmed: true,
    });

    // Then
    expect(context.knowledge.eligibleIds(context.owner, [unit.item.id])).toEqual([unit.item.id]);
  });
});
