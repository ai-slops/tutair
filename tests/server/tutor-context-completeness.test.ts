import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import type { StructuredCall } from "../../src/server/provider.js";
import { TutorPipeline } from "../../src/server/tutor.js";
import { boundModelContext } from "../../src/server/tutor-model-context.js";
import { createTutorTestContext, learnerMessage, providerFor } from "./tutor-test-fixtures.js";

describe("complete safety and knowledge context", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const db of databases.splice(0)) db.close();
  });

  it("preserves a complete maximum-size draft instead of cutting its safety-relevant tail", () => {
    const draft = `${"d".repeat(19_980)} safety-relevant-end`;
    const context = boundModelContext({
      message: "m".repeat(20_000),
      currentGoal: "g".repeat(2_000),
      draft,
    });
    expect(context["draft"]).toBe(draft);
  });

  it("keeps a retrieved existing unit in preparation, final selection, and lint", async () => {
    const context = createTutorTestContext(databases, "FSM", "FSM");
    const existing = z.object({ item: z.object({ id: z.string() }) }).parse(
      context.knowledge.create(context.owner, {
        title: "FSM invariant",
        statement: "FSM invariant",
        riskScope: "stable",
        confidence: 0.5,
      }),
    );
    const calls: StructuredCall[] = [];
    await new TutorPipeline(
      context.database,
      context.core,
      context.knowledge,
      providerFor(undefined, calls),
    ).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId: learnerMessage(context, "FSM"),
      content: "FSM",
      assistance: "none",
      selfReport: "neutral",
    });
    const stages = calls.filter((call) =>
      ["planning", "preparation", "lint", "final"].includes(call.stage),
    );
    expect(stages).toHaveLength(4);
    for (const call of stages)
      expect(
        z
          .array(z.object({ id: z.string() }))
          .parse(call.data["knowledge"])
          .map((unit) => unit.id),
      ).toContain(existing.item.id);
  });
});
