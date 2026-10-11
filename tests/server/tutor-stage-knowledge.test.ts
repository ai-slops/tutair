import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import type { StructuredCall } from "../../src/server/provider.js";
import { TutorPipeline } from "../../src/server/tutor.js";
import {
  createTutorTestContext,
  learnerMessage,
  machine,
  providerFor,
  stageOutput,
} from "./tutor-test-fixtures.js";

describe("same-turn knowledge propagation", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it("supplies newly resolved revision definitions and unknown state to planning, preparation and lint", async () => {
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
      (call) => call.stage === "planning" || call.stage === "preparation" || call.stage === "lint",
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

  it("offers a prior concept found by bounded extracted-candidate retrieval", async () => {
    const calls: StructuredCall[] = [];
    const context = createTutorTestContext(databases, "Paraphrase", "Learn the model");
    const prior = context.knowledge.create(context.owner, {
      title: machine.label,
      statement: machine.definition,
      semanticScope: machine.semanticScope,
      kind: machine.kind,
      aliases: machine.aliases,
      distinguishingFeatures: machine.distinguishingFeatures,
      claims: machine.claims,
      riskScope: machine.riskScope,
      confidence: machine.confidence,
      sourceType: "learner_manual",
    });
    const priorItem = z.object({ id: z.string() }).parse(prior.item);
    const provider = providerFor((call) => {
      if (call.stage !== "resolution") return stageOutput(call);
      const candidates = z
        .array(z.object({ key: z.string(), label: z.string() }))
        .parse(call.data["candidates"]);
      const offered = z
        .array(z.object({ id: z.string(), title: z.string(), revision: z.number() }))
        .parse(call.data["resolutionCandidates"]);
      return {
        matches: candidates.flatMap((candidate) => {
          const found = offered.find((item) => item.title === candidate.label);
          return found === undefined
            ? []
            : [
                {
                  candidateKey: candidate.key,
                  knowledgeId: found.id,
                  revision: found.revision,
                  confidence: 1,
                  decision: "exact" as const,
                  reasonCodes: ["same_named_definition"],
                },
              ];
        }),
        provisional: [],
      };
    }, calls);

    await new TutorPipeline(context.database, context.core, context.knowledge, provider).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId: learnerMessage(context, "Teach me this model in other words"),
      content: "Teach me this model in other words",
      assistance: "none",
      selfReport: "neutral",
    });

    const resolution = calls.find((call) => call.stage === "resolution");
    const offeredIds = z
      .array(z.object({ id: z.string() }))
      .parse(resolution?.data["resolutionCandidates"])
      .map((item) => item.id);
    expect(offeredIds).toContain(priorItem.id);
    expect(
      context.knowledge
        .list(context.owner)
        .filter((item) => z.object({ title: z.string() }).parse(item).title === machine.label),
    ).toHaveLength(1);
  });
});
