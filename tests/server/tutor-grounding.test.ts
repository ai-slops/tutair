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

describe("tutor reply grounding", () => {
  const databases: Database[] = [];
  afterEach(() => databases.splice(0).forEach((database) => void database.close()));

  it("rejects final free prose instead of accepting an unverifiable annotation", async () => {
    const provider = providerFor((call) =>
      call.stage === "final"
        ? { text: "An FSM models the controller.", exposures: [] }
        : stageOutput(call),
    );
    const context = createTutorTestContext(databases, "Controller", "Explain FSM");
    await expect(
      new TutorPipeline(context.database, context.core, context.knowledge, provider).turn({
        owner: context.owner,
        conversationId: context.conversationId,
        messageId: learnerMessage(context, "Explain FSM"),
        content: "Explain FSM",
        assistance: "none",
        selfReport: "neutral",
      }),
    ).rejects.toThrow(/required schema/);
    expect(
      context.database.all("SELECT id FROM exposures", [], z.object({ id: z.string() })),
    ).toEqual([]);
  });

  it("derives exact exposure spans from selected persisted blocks", async () => {
    const context = createTutorTestContext(databases, "Controller", "Build it");
    const result = await new TutorPipeline(
      context.database,
      context.core,
      context.knowledge,
      providerFor(),
    ).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId: learnerMessage(context, "Explain an FSM"),
      content: "Explain an FSM",
      assistance: "none",
      selfReport: "neutral",
    });
    const message = z.object({ id: z.string(), content: z.string() }).parse(result.tutorMessage);
    const exposures = context.database.all(
      "SELECT knowledge_id FROM exposures WHERE learner_id=? AND message_id=?",
      [context.owner, message.id],
      z.object({ knowledge_id: z.string() }),
    );
    const composition = context.database.one(
      "SELECT content_hash FROM answer_compositions WHERE learner_id=? AND message_id=?",
      [context.owner, message.id],
      z.object({ content_hash: z.string() }),
    );
    expect(message.content).toContain("finite-state machine");
    expect(exposures.length).toBeGreaterThan(0);
    expect(composition).not.toBeNull();
  });
});
