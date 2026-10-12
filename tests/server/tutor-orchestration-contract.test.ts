import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import type { StructuredCall } from "../../src/server/provider.js";
import { TutorPipeline } from "../../src/server/tutor.js";
import { extractionSchema, lintedSchema, planningSchema } from "../../src/server/tutor-schemas.js";
import {
  createTutorTestContext,
  learnerMessage,
  machine,
  providerFor,
  stageOutput,
} from "./tutor-test-fixtures.js";

describe("tutor orchestration contracts", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it("preserves the full micrograph and plan structures", () => {
    const call = { version: "v", system: "", data: {}, jsonSchema: {} } as const;
    const extracted = extractionSchema.parse(stageOutput({ ...call, stage: "extraction" }));
    const planned = planningSchema.parse(stageOutput({ ...call, stage: "planning" }));
    const linted = lintedSchema.parse(stageOutput({ ...call, stage: "lint" }));
    expect(extracted.artifacts.map((item) => item.label)).toEqual(["finite-state machine"]);
    expect(planned.assessmentOpportunities.map((item) => item.prompt)).toEqual([
      "Ask for the next transition",
    ]);
    expect(linted.generatedCandidates.map((item) => item.label)).toEqual(["determinism"]);
  });

  it.each([
    machine,
    {
      ...machine,
      definition: "A ceremonial machine with no transition semantics.",
      semanticScope: "ceremony",
    },
  ])("rejects candidate key reuse across extraction categories", (duplicate) => {
    const base = extractionSchema.parse(
      stageOutput({
        stage: "extraction",
        version: "v",
        system: "",
        data: {},
        jsonSchema: {},
      }),
    );
    expect(() =>
      extractionSchema.parse({
        ...base,
        prerequisites: [duplicate],
      }),
    ).toThrow(z.ZodError);
  });

  it("requires BCP 47 language tags at the extraction boundary", () => {
    const base = extractionSchema.parse(
      stageOutput({
        stage: "extraction",
        version: "v",
        system: "",
        data: {},
        jsonSchema: {},
      }),
    );

    expect(extractionSchema.safeParse({ ...base, responseLanguage: "한국어" }).success).toBe(false);
    expect(extractionSchema.safeParse({ ...base, sourceLanguage: "English" }).success).toBe(false);
    expect(
      extractionSchema.safeParse({ ...base, sourceLanguage: "en", responseLanguage: "ko" }).success,
    ).toBe(true);
  });

  it("rejects oversized extraction candidate text and aggregate candidate counts", () => {
    const base = extractionSchema.parse(
      stageOutput({
        stage: "extraction",
        version: "v",
        system: "",
        data: {},
        jsonSchema: {},
      }),
    );
    expect(() =>
      extractionSchema.parse({
        ...base,
        targets: [{ ...machine, definition: "x".repeat(4_001) }],
      }),
    ).toThrowError(z.ZodError);
    expect(() =>
      extractionSchema.parse({
        ...base,
        targets: Array.from({ length: 24 }, (_, index) => ({
          ...machine,
          key: `candidate-${index}`,
        })),
        prerequisites: [{ ...machine, key: "candidate-24" }],
      }),
    ).toThrowError(z.ZodError);
  });

  it("gives every stage the current goal and bounded learning context", async () => {
    const calls: StructuredCall[] = [];
    const context = createTutorTestContext(databases, "Controller", "Build the controller");
    context.core.createMessage(
      context.owner,
      context.conversationId,
      "tutor",
      "A state is a snapshot.",
    );
    const messageId = learnerMessage(context, "How do transitions work?");
    await new TutorPipeline(
      context.database,
      context.core,
      context.knowledge,
      providerFor(undefined, calls),
    ).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId,
      content: "How do transitions work?",
      assistance: "none",
      selfReport: "neutral",
    });
    const planning = calls.find((call) => call.stage === "planning");
    const evaluation = calls.find((call) => call.stage === "evaluation");
    expect(planning?.data["currentGoal"]).toBe("Build the controller");
    expect(evaluation?.data["recentContext"]).toEqual(
      expect.arrayContaining([expect.objectContaining({ content: "A state is a snapshot." })]),
    );
    expect(calls.filter((call) => call.stage === "resolution")).toHaveLength(1);
    expect(calls.filter((call) => call.stage === "preparation")).toHaveLength(1);
    expect(calls.filter((call) => call.stage === "final")).toHaveLength(1);
    expect(calls.filter((call) => call.stage === "lint")).toHaveLength(1);
    expect(calls.find((call) => call.stage === "extraction")?.data["languagePolicy"]).toMatchObject(
      {
        observableIntermediateLanguage: "en",
        responseLanguageSource: "question_bcp47",
      },
    );
    expect(
      calls.find((call) => call.stage === "preparation")?.data["languagePolicy"],
    ).toMatchObject({
      englishBaseLanguage: "en",
      localizedContentLanguage: "responseLanguage",
    });
    expect(calls.find((call) => call.stage === "final")?.data["languagePolicy"]).toMatchObject({
      output: "selection_ids_and_layout_only",
      rendering: "server",
    });
  });

  it("updates an existing thread goal with an event", async () => {
    const context = createTutorTestContext(databases, "Controller", "Old goal");
    const thread = z.object({ id: z.string() }).parse(
      context.core.createThread(context.owner, {
        title: "Old",
        goal: "Old goal",
        conversationId: context.conversationId,
      }),
    );
    const messageId = learnerMessage(context, "Continue");
    await new TutorPipeline(context.database, context.core, context.knowledge, providerFor()).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId,
      content: "Continue",
      assistance: "none",
      selfReport: "neutral",
    });
    expect(
      z.object({ goal: z.string() }).parse(context.core.thread(context.owner, thread.id)).goal,
    ).toBe("Build the controller");
    expect(
      context.database.all(
        "SELECT event_type FROM thread_events WHERE learner_id=? AND thread_id=? AND event_type='goal_updated'",
        [context.owner, thread.id],
        z.object({ event_type: z.string() }),
      ),
    ).toHaveLength(1);
  });

  it("rejects an extraction fallback that leaves no composable knowledge", async () => {
    const provider = providerFor((call) => {
      if (call.stage === "extraction" || call.stage === "lint")
        throw new Error("stage unavailable");
      return stageOutput(call);
    });
    const context = createTutorTestContext(databases, "Fallback", "Keep teaching");
    const messageId = learnerMessage(context, "Please continue");
    await expect(
      new TutorPipeline(context.database, context.core, context.knowledge, provider).turn({
        owner: context.owner,
        conversationId: context.conversationId,
        messageId,
        content: "Please continue",
        assistance: "none",
        selfReport: "neutral",
      }),
    ).rejects.toMatchObject({ code: "unresolved_answer_topic" });
    expect(
      context.database.all(
        "SELECT id FROM messages WHERE learner_id=? AND conversation_id=? AND role='tutor'",
        [context.owner, context.conversationId],
        z.object({ id: z.string() }),
      ),
    ).toEqual([]);
  });
});
