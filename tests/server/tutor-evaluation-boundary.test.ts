import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import { TutorPipeline } from "../../src/server/tutor.js";
import {
  createTutorTestContext,
  learnerMessage,
  providerFor,
  stageOutput,
} from "./tutor-test-fixtures.js";

describe("evaluation source boundary", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it.each(["unoffered", "assessment", "span", "thread"])(
    "rejects %s observations without partial mastery",
    async (invalid) => {
      const context = createTutorTestContext(databases, "FSM", "FSM");
      const create = (title: string) =>
        z
          .object({ item: z.object({ id: z.string() }), revision: z.object({ id: z.string() }) })
          .parse(
            context.knowledge.create(context.owner, {
              title,
              statement: title,
              riskScope: "stable",
              confidence: 0.5,
            }),
          );
      const unit = create("FSM");
      const other = create("zebra");
      const observation = {
        knowledgeId: unit.item.id,
        knowledgeRevisionId: unit.revision.id,
        revision: 1,
        dimension: "explanation",
        evidenceType: "free_explanation",
        polarity: "positive",
        score: 1,
        evaluatorConfidence: 1,
        ambiguous: false,
        copied: false,
        sourceSpans: [{ start: 0, end: 3 }],
        limitations: [],
        relatedKnowledgeIds: [],
        assessmentId: null,
        threadId: null,
        difficulty: 0.5,
      };
      const malformed = {
        ...observation,
        ...(invalid === "unoffered"
          ? { knowledgeId: other.item.id, knowledgeRevisionId: other.revision.id }
          : {}),
        ...(invalid === "assessment" ? { assessmentId: crypto.randomUUID() } : {}),
        ...(invalid === "span" ? { sourceSpans: [{ start: 0, end: 500 }] } : {}),
        ...(invalid === "thread" ? { threadId: crypto.randomUUID() } : {}),
      };
      const provider = providerFor((call) =>
        call.stage === "evaluation"
          ? { evidence: [observation, malformed], openQuestion: null }
          : stageOutput(call),
      );
      const result = await new TutorPipeline(
        context.database,
        context.core,
        context.knowledge,
        provider,
      ).turn({
        owner: context.owner,
        conversationId: context.conversationId,
        messageId: learnerMessage(context, "FSM"),
        content: "FSM",
        assistance: "none",
        selfReport: "neutral",
      });
      expect(result.run).toMatchObject({ evaluationSkipped: true });
      expect(context.knowledge.evidence(context.owner)).toEqual([]);
    },
  );

  it("pins evaluation to the learner source event even when the message changes during the call", async () => {
    const context = createTutorTestContext(databases, "FSM", "FSM");
    const unit = z
      .object({ item: z.object({ id: z.string() }), revision: z.object({ id: z.string() }) })
      .parse(
        context.knowledge.create(context.owner, {
          title: "FSM",
          statement: "FSM",
          riskScope: "stable",
          confidence: 0.5,
        }),
      );
    const messageId = learnerMessage(context, "FSM");
    const source = context.database.one(
      "SELECT id FROM message_events WHERE message_id=?",
      [messageId],
      z.object({ id: z.string() }),
    );
    const provider = providerFor((call) => {
      if (call.stage !== "evaluation") return stageOutput(call);
      context.core.editMessage(
        context.owner,
        context.conversationId,
        messageId,
        "Changed after dispatch",
      );
      return {
        evidence: [
          {
            knowledgeId: unit.item.id,
            knowledgeRevisionId: unit.revision.id,
            revision: 1,
            dimension: "explanation",
            evidenceType: "free_explanation",
            polarity: "positive",
            score: 1,
            evaluatorConfidence: 1,
            ambiguous: false,
            copied: false,
            sourceSpans: [{ start: 0, end: 3 }],
            limitations: [],
            relatedKnowledgeIds: [],
            assessmentId: null,
            threadId: null,
            difficulty: 0.5,
          },
        ],
        openQuestion: null,
      };
    });
    await new TutorPipeline(context.database, context.core, context.knowledge, provider).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId,
      content: "FSM",
      assistance: "none",
      selfReport: "neutral",
    });
    expect(context.knowledge.evidence(context.owner)).toEqual([
      expect.objectContaining({ message_event_id: source?.id }),
    ]);
  });
});
