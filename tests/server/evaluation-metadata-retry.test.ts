import { expect, it } from "vitest";
import { z } from "zod";
import { Database } from "../../src/server/database.js";
import { evaluatedSchema } from "../../src/server/evaluation-schema.js";
import { migrateModelContexts } from "../../src/server/model-context-migration.js";
import { ModelRunner } from "../../src/server/model-runner.js";
import type { StructuredCall, TutorProvider } from "../../src/server/provider.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import { TutorStageRunner } from "../../src/server/tutor-stage.js";

it("retries invalid evaluation metadata without weakening schema or losing either request", async () => {
  // Given
  const db = new Database(":memory:");
  migrateModelContexts(db.raw);
  const core = new CoreRepository(db);
  const owner = z.object({ id: z.string() }).parse(core.signup("Evaluation QA").learner).id;
  const conversation = z
    .object({ id: z.string() })
    .parse(core.createConversation(owner, "Metadata", null));
  const message = z
    .object({ id: z.string() })
    .parse(core.createMessage(owner, conversation.id, "learner", "My answer"));
  const calls: StructuredCall[] = [];
  const provider: TutorProvider = {
    embeddingProfile: "disabled:v1",
    state: {
      provider: "demo",
      model: "evaluation-test",
      generation: true,
      synthetic: true,
      embedding: "disabled",
    },
    async call(call) {
      calls.push(call);
      return {
        value:
          calls.length === 1
            ? {
                evidence: [],
                openQuestion: null,
                unresolvedAmbiguities: [],
                suggestedFollowup: {
                  knowledgeUnitId: "fictional",
                  dimension: "application",
                  method: "request_application",
                },
              }
            : {
                evidence: [],
                openQuestion: null,
                unresolvedAmbiguities: ["No grounded unit is available."],
                suggestedFollowup: null,
              },
        usage: null,
      };
    },
  };
  const stages = new TutorStageRunner(new ModelRunner(db, provider), {
    owner,
    conversationId: conversation.id,
    messageId: message.id,
    content: "My answer",
    assistance: "none",
    selfReport: "neutral",
  });

  try {
    // When
    const result = await stages.stage({
      stage: "evaluation",
      data: { message: "My answer" },
      schema: evaluatedSchema,
    });

    // Then
    expect(result.value.suggestedFollowup).toBeNull();
    expect(calls).toHaveLength(2);
    expect(calls.every((call) => call.version === "phase1-evaluation-v2")).toBe(true);
    expect(calls[1]?.data["repairOfRunId"]).toEqual(expect.any(String));
    expect(
      db.one(
        "SELECT COUNT(*) AS count FROM model_run_contexts",
        [],
        z.object({ count: z.number() }),
      )?.count,
    ).toBe(2);
    const persisted = db.one(
      "SELECT d.output_json FROM model_run_details d JOIN model_runs r ON r.id=d.run_id WHERE r.status='completed'",
      [],
      z.object({ output_json: z.string() }),
    );
    expect(evaluatedSchema.parse(JSON.parse(persisted?.output_json ?? "null"))).toEqual(
      result.value,
    );
    expect(
      db.all(
        "SELECT r.version,d.schema_version FROM model_runs r JOIN model_run_details d ON d.run_id=r.id ORDER BY r.created_at",
        [],
        z.object({ version: z.string(), schema_version: z.string() }),
      ),
    ).toEqual([
      { version: "phase1-evaluation-v2", schema_version: "phase1-evaluation-schema-v3" },
      { version: "phase1-evaluation-v2", schema_version: "phase1-evaluation-schema-v3" },
    ]);
  } finally {
    db.close();
  }
});
