import { expect, it } from "vitest";
import { z } from "zod";
import { Database } from "../../src/server/database.js";
import { ModelRunner } from "../../src/server/model-runner.js";
import type { StructuredCall, TutorProvider } from "../../src/server/provider.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import { extractionSchema } from "../../src/server/tutor-schemas.js";
import { TutorStageRunner } from "../../src/server/tutor-stage.js";
import { machine, stageOutput } from "./tutor-test-fixtures.js";

it.each([false, true])(
  "corrects an invalid enum once without weakening validation (always invalid: %s)",
  async (alwaysInvalid) => {
    const db = new Database(":memory:");
    try {
      const core = new CoreRepository(db);
      const owner = z.object({ id: z.string() }).parse(core.signup("Correction QA").learner).id;
      const conversation = z
        .object({ id: z.string() })
        .parse(core.createConversation(owner, "Schema QA", null));
      const message = z
        .object({ id: z.string() })
        .parse(core.createMessage(owner, conversation.id, "learner", "Explain FSM"));
      const calls: StructuredCall[] = [];
      const provider: TutorProvider = {
        state: {
          provider: "demo",
          model: "test",
          generation: true,
          synthetic: true,
          embedding: "disabled",
        },
        embeddingProfile: "disabled:v1",
        async call(call) {
          calls.push(call);
          return {
            value: { kind: calls.length === 1 || alwaysInvalid ? "example" : "concept" },
            usage: null,
          };
        },
      };
      const stages = new TutorStageRunner(new ModelRunner(db, provider), {
        owner,
        conversationId: conversation.id,
        messageId: message.id,
        content: "Explain FSM",
        assistance: "none",
        selfReport: "neutral",
      });
      const result = stages.stage({
        stage: "extraction",
        data: { message: "Explain FSM" },
        schema: z.object({ kind: z.enum(["concept", "term_sense"]) }),
      });
      if (alwaysInvalid) await expect(result).rejects.toThrow();
      else expect((await result).value).toEqual({ kind: "concept" });
      expect(calls).toHaveLength(2);
      expect(calls[1]?.data["outputCorrection"]).toMatchObject({
        previousOutput: { kind: "example" },
        issues: [expect.objectContaining({ code: "invalid_value", path: ["kind"] })],
      });
      const rows = db.all(
        "SELECT status FROM model_runs ORDER BY created_at",
        [],
        z.object({ status: z.string() }),
      );
      expect(rows.map((row) => row.status)).toEqual([
        "failed",
        alwaysInvalid ? "failed" : "completed",
      ]);
    } finally {
      db.close();
    }
  },
);

it("repairs candidate keys reused across extraction categories", async () => {
  const db = new Database(":memory:");
  try {
    const core = new CoreRepository(db);
    const owner = z.object({ id: z.string() }).parse(core.signup("Candidate QA").learner).id;
    const conversation = z
      .object({ id: z.string() })
      .parse(core.createConversation(owner, "Extraction QA", null));
    const message = z
      .object({ id: z.string() })
      .parse(core.createMessage(owner, conversation.id, "learner", "Compare two logics"));
    const validOutput = extractionSchema.parse(
      stageOutput({ stage: "extraction", version: "v", system: "", data: {}, jsonSchema: {} }),
    );
    const duplicatedOutput = {
      ...validOutput,
      artifacts: [machine, ...validOutput.artifacts],
    };
    const calls: StructuredCall[] = [];
    const provider: TutorProvider = {
      state: {
        provider: "demo",
        model: "test",
        generation: true,
        synthetic: true,
        embedding: "disabled",
      },
      embeddingProfile: "disabled:v1",
      async call(call) {
        calls.push(call);
        return { value: calls.length === 1 ? duplicatedOutput : validOutput, usage: null };
      },
    };
    const result = await new TutorStageRunner(new ModelRunner(db, provider), {
      owner,
      conversationId: conversation.id,
      messageId: message.id,
      content: "Compare two logics",
      assistance: "none",
      selfReport: "neutral",
    }).stage({
      stage: "extraction",
      data: { message: "Compare two logics" },
      schema: extractionSchema,
    });

    expect(calls).toHaveLength(2);
    const correction = z
      .object({
        previousOutput: z.unknown(),
        issues: z.array(
          z.object({
            code: z.string(),
            path: z.array(z.union([z.string(), z.number()])),
          }),
        ),
      })
      .parse(calls[1]?.data["outputCorrection"]);
    expect(correction.previousOutput).toEqual(duplicatedOutput);
    expect(correction.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "custom", path: ["candidateKey", "fsm"] }),
      ]),
    );
    expect(correction.issues).toHaveLength(1);
    expect(result.value).toEqual(validOutput);
    const rows = db.all(
      `SELECT r.status,i.attempt,i.repair_of_run_id FROM model_runs r
       JOIN model_run_inspection i ON i.run_id=r.id ORDER BY r.created_at`,
      [],
      z.object({
        status: z.string(),
        attempt: z.number(),
        repair_of_run_id: z.string().nullable(),
      }),
    );
    expect(rows.map((row) => row.status)).toEqual(["failed", "completed"]);
    expect(rows.map((row) => row.attempt)).toEqual([1, 2]);
    expect(rows[1]?.repair_of_run_id).not.toBeNull();
  } finally {
    db.close();
  }
});

it("rejects one key shared by a knowledge unit and material request", () => {
  const validOutput = extractionSchema.parse(
    stageOutput({ stage: "extraction", version: "v", system: "", data: {}, jsonSchema: {} }),
  );

  expect(
    extractionSchema.safeParse({
      ...validOutput,
      artifacts: [...validOutput.artifacts, machine],
    }).success,
  ).toBe(false);
});

it("permits distinct keys for candidates with the same label", () => {
  const validOutput = extractionSchema.parse(
    stageOutput({ stage: "extraction", version: "v", system: "", data: {}, jsonSchema: {} }),
  );

  expect(
    extractionSchema.safeParse({
      ...validOutput,
      artifacts: [...validOutput.artifacts, { ...machine, key: "fsm-material" }],
    }).success,
  ).toBe(true);
});
