import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import type { StructuredCall } from "../../src/server/provider.js";
import { TutorPipeline } from "../../src/server/tutor.js";
import { extractionSchema } from "../../src/server/tutor-schemas.js";
import {
  createTutorTestContext,
  learnerMessage,
  machine,
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

  it("repairs duplicate extraction keys before resolution and completes the pipeline", async () => {
    const context = createTutorTestContext(databases, "Logic", "Compare two logics");
    const calls: StructuredCall[] = [];
    let extractionAttempts = 0;
    let knowledgeCountAtRepair: number | null = null;
    const provider = providerFor((call) => {
      calls.push(call);
      if (call.stage !== "extraction") return stageOutput(call);
      extractionAttempts += 1;
      const validOutput = extractionSchema.parse(stageOutput(call));
      if (extractionAttempts === 2)
        knowledgeCountAtRepair = context.knowledge.list(context.owner).length;
      return extractionAttempts === 1
        ? {
            ...validOutput,
            artifacts: [machine, ...validOutput.artifacts],
          }
        : validOutput;
    });

    const result = await new TutorPipeline(
      context.database,
      context.core,
      context.knowledge,
      provider,
    ).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId: learnerMessage(context, "Compare two logics"),
      content: "Compare two logics",
      assistance: "none",
      selfReport: "neutral",
    });
    const resolutionCall = calls.find((call) => call.stage === "resolution");
    const resolutionCandidates = z
      .array(z.object({ key: z.string() }))
      .parse(resolutionCall?.data["candidates"]);
    const extractionRuns = context.database.all(
      `SELECT r.status,i.attempt,i.repair_of_run_id FROM model_runs r
       JOIN model_run_inspection i ON i.run_id=r.id WHERE r.stage='extraction'
       ORDER BY r.created_at`,
      [],
      z.object({
        status: z.string(),
        attempt: z.number(),
        repair_of_run_id: z.string().nullable(),
      }),
    );

    expect(z.object({ status: z.literal("completed") }).parse(result.run).status).toBe("completed");
    expect(extractionAttempts).toBe(2);
    expect(knowledgeCountAtRepair).toBe(0);
    expect(extractionRuns.map((run) => run.status)).toEqual(["failed", "completed"]);
    expect(extractionRuns.map((run) => run.attempt)).toEqual([1, 2]);
    expect(extractionRuns[1]?.repair_of_run_id).not.toBeNull();
    expect(resolutionCandidates.map((candidate) => candidate.key)).toHaveLength(
      new Set(resolutionCandidates.map((candidate) => candidate.key)).size,
    );
    expect(context.knowledge.list(context.owner)).toHaveLength(1);
  });
});
