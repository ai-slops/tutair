import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import type { StructuredCall } from "../../src/server/provider.js";
import { TutorPipeline } from "../../src/server/tutor.js";
import {
  MODEL_CONTEXT_JSON_BUDGET,
  MODEL_CONTEXT_TEXT_BUDGET,
  modelContextTextSize,
} from "../../src/server/tutor-model-context.js";
import {
  createTutorTestContext,
  learnerMessage,
  providerFor,
  type TutorTestContext,
} from "./tutor-test-fixtures.js";

function createUnit(context: TutorTestContext, title: string, statement: string) {
  return z
    .object({ item: z.object({ id: z.string() }), revision: z.object({ id: z.string() }) })
    .parse(
      context.knowledge.create(context.owner, {
        title,
        statement,
        riskScope: "stable",
        confidence: 0.8,
      }),
    );
}

describe("tutor context budgets", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it("keeps every model payload under one aggregate context bound", async () => {
    const calls: StructuredCall[] = [];
    const context = createTutorTestContext(databases, "Large context", "aggregatefocus");
    const units = Array.from({ length: 16 }, (_, index) =>
      z
        .object({
          item: z.object({ id: z.string(), scope: z.string() }),
          revision: z.object({ id: z.string() }),
        })
        .parse(
          context.knowledge.create(context.owner, {
            title: `aggregatefocus-${index}`,
            statement: `aggregatefocus ${index} ${"definition".repeat(950)}`,
            aliases: ["alias".repeat(500)],
            distinguishingFeatures: ["feature".repeat(500)],
            claims: ["claim".repeat(1_000)],
            riskScope: "stable",
            confidence: 0.8,
          }),
        ),
    );
    for (let index = 0; index < 8; index += 1)
      context.core.createMessage(
        context.owner,
        context.conversationId,
        index % 2 === 0 ? "tutor" : "learner",
        `history-${index}-${"h".repeat(20_000)}`,
      );
    const messageId = learnerMessage(context, "Explain aggregatefocus-0");
    await new TutorPipeline(
      context.database,
      context.core,
      context.knowledge,
      providerFor(undefined, calls),
    ).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId,
      content: "Explain aggregatefocus-0",
      assistance: "none",
      selfReport: "neutral",
    });
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(JSON.stringify(call.data).length).toBeLessThanOrEqual(MODEL_CONTEXT_JSON_BUDGET);
      expect(modelContextTextSize(call.data)).toBeLessThanOrEqual(MODEL_CONTEXT_TEXT_BUDGET);
    }
    const evaluation = calls.find((call) => call.stage === "evaluation");
    const contexts = z
      .array(
        z.object({
          id: z.string(),
          revisionId: z.string(),
          scope: z.string(),
          definition: z.string(),
        }),
      )
      .parse(evaluation?.data["knowledge"]);
    const first = contexts.find((item) => item.id === units[0]?.item.id);
    expect(first).toMatchObject({
      id: units[0]?.item.id,
      revisionId: units[0]?.revision.id,
      scope: units[0]?.item.scope,
    });
    expect(first?.definition.length).toBeLessThan(10_000);
  });

  it("only returns relations whose two endpoints fit the selected knowledge cap", async () => {
    const calls: StructuredCall[] = [];
    const context = createTutorTestContext(databases, "Relations", "relationfocus");
    for (let index = 0; index < 16; index += 1) {
      const target = createUnit(context, `relationfocus-${index}`, `relationfocus target ${index}`);
      const prerequisite = createUnit(
        context,
        `prerequisite-${index}`,
        `hidden prerequisite ${index}`,
      );
      context.database.run("INSERT INTO knowledge_relations VALUES(?,?,?,?,?,?,?,?,?,?)", [
        crypto.randomUUID(),
        context.owner,
        prerequisite.item.id,
        target.item.id,
        "prerequisite",
        prerequisite.revision.id,
        target.revision.id,
        "0.9",
        0,
        `2020-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      ]);
    }
    const messageId = learnerMessage(context, "relationfocus");
    await new TutorPipeline(
      context.database,
      context.core,
      context.knowledge,
      providerFor(undefined, calls),
    ).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId,
      content: "relationfocus",
      assistance: "none",
      selfReport: "neutral",
    });
    const evaluation = calls.find((call) => call.stage === "evaluation");
    const ids = new Set(
      z
        .array(z.object({ id: z.string() }))
        .parse(evaluation?.data["knowledge"])
        .map((item) => item.id),
    );
    const relations = z
      .array(z.object({ from_knowledge_id: z.string(), to_knowledge_id: z.string() }))
      .parse(evaluation?.data["relations"]);
    expect(ids.size).toBeLessThanOrEqual(24);
    expect(relations.length).toBeGreaterThan(0);
    for (const relation of relations) {
      expect(ids.has(relation.from_knowledge_id)).toBe(true);
      expect(ids.has(relation.to_knowledge_id)).toBe(true);
    }
  });
});
