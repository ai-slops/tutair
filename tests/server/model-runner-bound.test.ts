import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { z } from "zod";
import { Database } from "../../src/server/database.js";
import { ModelRunner } from "../../src/server/model-runner.js";
import type { StructuredCall, TutorProvider } from "../../src/server/provider.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import {
  MODEL_CONTEXT_JSON_BUDGET,
  MODEL_CONTEXT_TEXT_BUDGET,
  modelContextTextSize,
} from "../../src/server/tutor-model-context.js";

it("bounds final-review data at the common model-call boundary and hashes exactly what is sent", async () => {
  const db = new Database(":memory:");
  try {
    const core = new CoreRepository(db);
    const owner = z.object({ id: z.string() }).parse(core.signup("Bounded QA").learner).id;
    const conversation = z
      .object({ id: z.string() })
      .parse(core.createConversation(owner, "Budget", null));
    const message = z
      .object({ id: z.string() })
      .parse(core.createMessage(owner, conversation.id, "learner", "Explain the idea"));
    const calls: StructuredCall[] = [];
    let providerStageOperationId = "";
    const provider: TutorProvider = {
      embeddingProfile: "disabled:v1",
      state: {
        provider: "demo",
        model: "test",
        generation: true,
        synthetic: true,
        embedding: "disabled",
      },
      async call(call, _owner, context) {
        calls.push(call);
        providerStageOperationId = context?.scope.id ?? "";
        return { value: { safe: true }, usage: null };
      },
    };
    const data = {
      finalReview: true,
      message: "m".repeat(20_000),
      draft: "d".repeat(20_000),
      relevantHistory: Array.from({ length: 16 }, () => ({ content: "h".repeat(20_000) })),
      plan: { currentGoal: "g".repeat(1000) },
    };
    const result = await new ModelRunner(db, provider).stage(
      owner,
      conversation.id,
      message.id,
      "lint",
      data,
      z.object({ safe: z.boolean() }),
    );
    const sent = calls[0]?.data;
    expect(sent).toBeDefined();
    expect(modelContextTextSize(sent)).toBeLessThanOrEqual(MODEL_CONTEXT_TEXT_BUDGET);
    expect(JSON.stringify(sent).length).toBeLessThanOrEqual(MODEL_CONTEXT_JSON_BUDGET);
    expect(data.draft.length).toBe(20_000);
    const run = db.one(
      `SELECT d.input_hash,i.runtime_operation_id FROM model_run_details d
       JOIN model_run_inspection i ON i.run_id=d.run_id WHERE d.run_id=?`,
      [result.runId],
      z.object({ input_hash: z.string(), runtime_operation_id: z.string() }),
    );
    expect(run?.input_hash).toBe(createHash("sha256").update(JSON.stringify(sent)).digest("hex"));
    expect(providerStageOperationId).toMatch(/^[0-9a-f-]{36}$/);
    expect(run?.runtime_operation_id).toBe(providerStageOperationId);
  } finally {
    db.close();
  }
});
