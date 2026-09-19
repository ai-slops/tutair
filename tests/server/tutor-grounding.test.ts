import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import { TutorPipeline } from "../../src/server/tutor.js";
import {
  createTutorTestContext,
  learnerMessage,
  providerFor,
  stageOutput,
} from "./tutor-test-fixtures.js";

describe("tutor reply grounding", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it("stores only final-text-grounded exposures and rebuilds their state", async () => {
    const provider = providerFor((call) => {
      if (call.stage !== "final") return stageOutput(call);
      const allowed = z.array(z.string()).parse(call.data["allowedKnowledgeIds"]);
      const knowledge = z
        .array(z.object({ id: z.string(), title: z.string() }))
        .parse(call.data["knowledge"]);
      const machine = knowledge.find((item) => item.title === "finite-state machine");
      const text = "A finite-state machine models the controller.";
      return {
        text,
        exposures:
          machine === undefined || !allowed.includes(machine.id)
            ? []
            : [{ knowledgeId: machine.id, sourceSpan: { start: 2, end: 22 } }],
      };
    });
    const context = createTutorTestContext(databases, "Controller", "Build it");
    const messageId = learnerMessage(context, "Explain an FSM");
    const result = await new TutorPipeline(
      context.database,
      context.core,
      context.knowledge,
      provider,
    ).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId,
      content: "Explain an FSM",
      assistance: "none",
      selfReport: "neutral",
    });
    const changes = z.array(z.unknown()).parse(result.knowledgeChanges);
    const exposures = context.database.all(
      "SELECT knowledge_id FROM exposures WHERE learner_id=?",
      [context.owner],
      z.object({ knowledge_id: z.string() }),
    );
    const states = context.database.all(
      "SELECT knowledge_id,status FROM learner_state WHERE learner_id=? AND status='exposed'",
      [context.owner],
      z.object({ knowledge_id: z.string(), status: z.string() }),
    );
    expect(changes.length).toBeGreaterThan(1);
    expect(exposures).toHaveLength(1);
    expect(states.map((item) => item.knowledge_id)).toEqual([exposures[0]?.knowledge_id]);
  });
});
