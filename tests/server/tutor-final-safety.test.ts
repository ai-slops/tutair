import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import { TutorPipeline } from "../../src/server/tutor.js";
import { extractionSchema } from "../../src/server/tutor-schemas.js";
import {
  createTutorTestContext,
  learnerMessage,
  machine,
  providerFor,
  stageOutput,
} from "./tutor-test-fixtures.js";

describe("tutor final safety", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it("blocks an unsafe high-stakes final answer before persisting tutor output", async () => {
    const provider = providerFor((call) => {
      if (call.stage === "extraction") {
        const value = extractionSchema.parse(stageOutput(call));
        return {
          ...value,
          targets: [{ ...machine, riskScope: "high-stakes", label: "medication dosage" }],
        };
      }
      if (call.stage === "lint" && call.data["finalReview"] === true)
        return {
          safe: false,
          issues: ["unsafe_medical_certainty"],
          concepts: [],
          generatedCandidates: [],
          lintSkipped: false,
        };
      return stageOutput(call);
    });
    const context = createTutorTestContext(databases, "Medicine", "Choose a dose");
    const messageId = learnerMessage(context, "What dose?");
    await expect(
      new TutorPipeline(context.database, context.core, context.knowledge, provider).turn({
        owner: context.owner,
        conversationId: context.conversationId,
        messageId,
        content: "What dose?",
        assistance: "none",
        selfReport: "neutral",
      }),
    ).rejects.toMatchObject({ code: "unsafe_tutor_output" });
    expect(
      context.database.all(
        "SELECT id FROM messages WHERE learner_id=? AND conversation_id=? AND role='tutor'",
        [context.owner, context.conversationId],
        z.object({ id: z.string() }),
      ),
    ).toEqual([]);
  });
});
