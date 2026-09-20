import { expect, it } from "vitest";
import { z } from "zod";
import { Database } from "../../src/server/database.js";
import { ModelRunner } from "../../src/server/model-runner.js";
import type { StructuredCall, TutorProvider } from "../../src/server/provider.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import { TutorStageRunner } from "../../src/server/tutor-stage.js";

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
