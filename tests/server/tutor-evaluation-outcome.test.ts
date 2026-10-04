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

describe("observable evaluation outcomes", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it.each([false, true])(
    "distinguishes empty evidence from skipped evaluation (failure=%s)",
    async (fails) => {
      const context = createTutorTestContext(databases, "FSM", "Explain FSM");
      const provider = providerFor((call) => {
        if (call.stage === "evaluation" && fails) throw new Error("Evaluation unavailable");
        return stageOutput(call);
      });
      const result = await new TutorPipeline(
        context.database,
        context.core,
        context.knowledge,
        provider,
      ).turn({
        owner: context.owner,
        conversationId: context.conversationId,
        messageId: learnerMessage(context, "Explain FSM"),
        content: "Explain FSM",
        assistance: "none",
        selfReport: "neutral",
      });
      expect(result.run).toMatchObject({ evaluationSkipped: fails });
      expect(context.knowledge.evidence(context.owner)).toEqual([]);
    },
  );

  it.each([false, true])(
    "records only followups for offered knowledge (unoffered=%s)",
    async (unoffered) => {
      const context = createTutorTestContext(databases, "FSM", "Explain FSM");
      const unit = z.object({ item: z.object({ id: z.string() }) }).parse(
        context.knowledge.create(context.owner, {
          title: "FSM",
          statement: "Finite states",
          riskScope: "stable",
          confidence: 0.5,
        }),
      );
      const provider = providerFor((call) =>
        call.stage === "evaluation"
          ? {
              evidence: [],
              openQuestion: null,
              unresolvedAmbiguities: ["Needs an independent explanation"],
              suggestedFollowup: {
                knowledgeUnitId: unoffered ? "00000000-0000-4000-8000-000000000001" : unit.item.id,
                dimension: "explanation",
                method: "ask_explanation",
              },
            }
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
      expect(result.run).toMatchObject({ followupTrackingSkipped: unoffered });
      const questions = context.database.all(
        "SELECT question FROM open_questions",
        [],
        z.object({ question: z.string() }),
      );
      expect(questions).toHaveLength(unoffered ? 0 : 1);
      const traces = context.database.all(
        "SELECT data_json FROM traces WHERE event='evaluation_outcome'",
        [],
        z.object({ data_json: z.string() }),
      );
      const outcome = z
        .object({ unresolvedAmbiguities: z.array(z.string()), followupAccepted: z.boolean() })
        .parse(JSON.parse(z.string().parse(traces[0]?.data_json)));
      expect(outcome).toEqual({
        unresolvedAmbiguities: ["Needs an independent explanation"],
        followupAccepted: !unoffered,
      });
    },
  );
});
