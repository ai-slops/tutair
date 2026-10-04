import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import type { StructuredCall } from "../../src/server/provider.js";
import { TutorPipeline } from "../../src/server/tutor.js";
import { createTutorTestContext, learnerMessage, providerFor } from "./tutor-test-fixtures.js";

describe("same-turn knowledge propagation", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it("supplies newly resolved revision definitions and unknown state to planning, draft and lint", async () => {
    const calls: StructuredCall[] = [];
    const context = createTutorTestContext(databases, "New topic", "Explain the controller");
    await new TutorPipeline(
      context.database,
      context.core,
      context.knowledge,
      providerFor(undefined, calls),
    ).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId: learnerMessage(context, "Explain the controller"),
      content: "Explain the controller",
      assistance: "none",
      selfReport: "neutral",
    });
    const stages = calls.filter(
      (call) =>
        call.stage === "planning" ||
        call.stage === "draft" ||
        (call.stage === "lint" && call.data["finalReview"] !== true),
    );
    expect(stages).toHaveLength(3);
    const definition = z.object({ id: z.string(), revisionId: z.string(), definition: z.string() });
    const planned = z.array(definition).parse(stages[0]?.data["knowledge"]);
    expect(planned.length).toBeGreaterThan(0);
    for (const stage of stages) {
      expect(z.array(definition).parse(stage.data["knowledge"])).toEqual(planned);
      const states = z
        .array(z.object({ knowledge_revision_id: z.string(), status: z.string() }))
        .parse(stage.data["learnerStates"]);
      expect(states).toHaveLength(planned.length * 6);
      expect(states.every((state) => state.status === "unknown")).toBe(true);
      expect(new Set(states.map((state) => state.knowledge_revision_id))).toEqual(
        new Set(planned.map((item) => item.revisionId)),
      );
    }
    const final = calls.find((call) => call.stage === "final");
    expect(final?.data["plan"]).toBeDefined();
  });
});
