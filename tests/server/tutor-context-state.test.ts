import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import type { StructuredCall } from "../../src/server/provider.js";
import { TutorPipeline } from "../../src/server/tutor.js";
import {
  createTutorTestContext,
  learnerMessage,
  providerFor,
  stageOutput,
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

describe("tutor context state", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it("makes newly evaluated evidence visible to planning in the same turn", async () => {
    const calls: StructuredCall[] = [];
    const context = createTutorTestContext(databases, "FSM", "Explain machines");
    const created = createUnit(
      context,
      "finite-state machine",
      "A finite collection of states and transitions.",
    );
    const provider = providerFor(
      (call) =>
        call.stage === "evaluation"
          ? {
              evidence: [
                {
                  knowledgeId: created.item.id,
                  knowledgeRevisionId: created.revision.id,
                  revision: 1,
                  dimension: "explanation",
                  evidenceType: "free_explanation",
                  polarity: "positive",
                  score: 0.8,
                  evaluatorConfidence: 0.9,
                  ambiguous: false,
                  copied: false,
                  sourceSpans: [{ start: 0, end: 18 }],
                  limitations: [],
                  relatedKnowledgeIds: [],
                  assessmentId: null,
                  threadId: null,
                  difficulty: 0.4,
                },
              ],
              openQuestion: null,
            }
          : stageOutput(call),
      calls,
    );
    const content = "An FSM is a model.";
    const messageId = learnerMessage(context, content);
    await new TutorPipeline(context.database, context.core, context.knowledge, provider).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId,
      content,
      assistance: "none",
      confidence: 0.8,
      selfReport: "confident",
    });
    const evaluation = calls.find((call) => call.stage === "evaluation");
    const planning = calls.find((call) => call.stage === "planning");
    const initialLint = calls.find(
      (call) => call.stage === "lint" && call.data["finalReview"] !== true,
    );
    expect(evaluation?.data["selfReport"]).toBe("confident");
    expect(evaluation?.data["confidence"]).toBe(0.8);
    expect(planning?.data["supportingEvidence"]).toEqual(
      expect.arrayContaining([expect.objectContaining({ knowledge_id: created.item.id })]),
    );
    expect(planning?.data["learnerStates"]).toEqual(
      expect.arrayContaining([expect.objectContaining({ knowledge_id: created.item.id })]),
    );
    expect(initialLint?.data["knownStates"]).toEqual(
      expect.arrayContaining([expect.objectContaining({ knowledge_id: created.item.id })]),
    );
  });

  it("bounds knowledge to retrieved units while expanding an old prerequisite state", async () => {
    const calls: StructuredCall[] = [];
    const context = createTutorTestContext(databases, "Astronomy", "Understand a quasar");
    const target = createUnit(context, "quasar", "A quasar is a luminous active galactic nucleus.");
    const prerequisite = createUnit(
      context,
      "galaxy",
      "A galaxy is a gravitationally bound stellar system.",
    );
    for (let index = 0; index < 30; index += 1)
      createUnit(
        context,
        `unrelated-${index}`,
        `Large unrelated knowledge payload ${index} ${"x".repeat(300)}`,
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
      "2020-01-01T00:00:00.000Z",
    ]);
    context.database.run(
      "INSERT INTO learner_state(id,learner_id,knowledge_id,knowledge_revision_id,revision,dimension,estimate,uncertainty,status,effective_evidence,last_observation,evidence_ids_json,projection_version,projected_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      [
        crypto.randomUUID(),
        context.owner,
        prerequisite.item.id,
        prerequisite.revision.id,
        1,
        "recognition",
        0.8,
        0.2,
        "supported",
        1,
        "2020-01-01T00:00:00.000Z",
        "[]",
        "test-v1",
        "2020-01-01T00:00:00.000Z",
      ],
    );
    const content = "How does a quasar work?";
    const messageId = learnerMessage(context, content);
    await new TutorPipeline(
      context.database,
      context.core,
      context.knowledge,
      providerFor(undefined, calls),
    ).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId,
      content,
      assistance: "none",
      selfReport: "neutral",
    });
    const evaluation = calls.find((call) => call.stage === "evaluation");
    const offered = z
      .array(z.object({ id: z.string(), title: z.string() }))
      .parse(evaluation?.data["knowledge"]);
    expect(offered.map((item) => item.id)).toEqual(
      expect.arrayContaining([target.item.id, prerequisite.item.id]),
    );
    expect(offered.some((item) => item.title.startsWith("unrelated-"))).toBe(false);
    expect(evaluation?.data["learnerStates"]).toEqual(
      expect.arrayContaining([expect.objectContaining({ knowledge_id: prerequisite.item.id })]),
    );
    expect(JSON.stringify(evaluation?.data["knowledge"]).length).toBeLessThan(10_000);
  });
});
