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

const snapshotSchema = z.object({
  id: z.string(),
  revision: z.number(),
  revisionId: z.string(),
});
const exposureSchema = z.object({
  knowledge_id: z.string(),
  revision: z.number(),
  knowledge_revision_id: z.string(),
  message_id: z.string(),
  message_event_id: z.string(),
  provenance: z.literal("generation_snapshot"),
});

describe("exposure provenance", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it.each(["generation", "review", "repair"] as const)(
    "pins exposure to the supplied revision when knowledge changes during %s",
    async (changeAt) => {
      // Given
      const context = createTutorTestContext(databases, "FSM", "Explain an FSM");
      let supplied: z.infer<typeof snapshotSchema> | undefined;
      let changed = false;
      let finalCalls = 0;
      const provider = providerFor((call) => {
        if (call.stage === "final") {
          finalCalls += 1;
          supplied = snapshotSchema.parse(z.array(z.unknown()).parse(call.data["knowledge"])[0]);
        }
        if (
          supplied !== undefined &&
          !changed &&
          ((changeAt !== "review" && call.stage === "final") ||
            (changeAt === "review" && call.data["finalReview"] === true))
        ) {
          context.knowledge.addRevision(context.owner, {
            knowledgeId: supplied.id,
            statement: "A different revision created while the answer is being generated",
            sourceType: "learner_manual",
            sourceRef: null,
          });
          changed = true;
        }
        if (call.stage !== "final") return stageOutput(call);
        const snapshot = snapshotSchema.parse(supplied);
        const text = "An FSM has states and transition rules.";
        return {
          text,
          exposures: [
            {
              knowledgeId: snapshot.id,
              ...(changeAt === "repair" && finalCalls === 1 ? {} : { sourceQuote: text }),
            },
          ],
        };
      });

      // When
      await new TutorPipeline(context.database, context.core, context.knowledge, provider).turn({
        owner: context.owner,
        conversationId: context.conversationId,
        messageId: learnerMessage(context, "Explain an FSM"),
        content: "Explain an FSM",
        assistance: "none",
        selfReport: "neutral",
      });

      // Then
      const snapshot = snapshotSchema.parse(supplied);
      const row = context.database.one(
        "SELECT * FROM exposures WHERE knowledge_id=?",
        [snapshot.id],
        z.object({ revision: z.number() }).passthrough(),
      );
      expect(row?.revision).toBe(snapshot.revision);
      expect(exposureSchema.parse(row).knowledge_revision_id).toBe(snapshot.revisionId);
      expect(context.knowledge.item(context.owner, snapshot.id).current_revision).toBe(2);
      expect(finalCalls).toBe(changeAt === "repair" ? 2 : 1);
      expect(context.knowledge.learnerState(context.owner, snapshot.id, 2)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ dimension: "recognition", status: "unknown" }),
        ]),
      );
    },
  );

  it("retains the original tutor event after message edits and tombstones", async () => {
    // Given
    const context = createTutorTestContext(databases, "FSM", "Explain an FSM");
    const text = "An FSM has states and transition rules.";
    const provider = providerFor((call) => {
      if (call.stage !== "final") return stageOutput(call);
      const first = snapshotSchema.parse(z.array(z.unknown()).parse(call.data["knowledge"])[0]);
      return { text, exposures: [{ knowledgeId: first.id, sourceQuote: text }] };
    });
    const result = await new TutorPipeline(
      context.database,
      context.core,
      context.knowledge,
      provider,
    ).turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId: learnerMessage(context, "Explain an FSM"),
      content: "Explain an FSM",
      assistance: "none",
      selfReport: "neutral",
    });
    const messageId = z.object({ id: z.string() }).parse(result.tutorMessage).id;

    // When
    context.core.editMessage(context.owner, context.conversationId, messageId, "Edited answer");
    context.core.tombstone(context.owner, context.conversationId, messageId);

    // Then
    const exposure = exposureSchema.parse(
      context.database.one("SELECT * FROM exposures", [], z.record(z.string(), z.unknown())),
    );
    expect(exposure.message_id).toBe(messageId);
    expect(
      context.database.one(
        "SELECT content,event_type FROM message_events WHERE id=?",
        [exposure.message_event_id],
        z.object({ content: z.string(), event_type: z.string() }),
      ),
    ).toEqual({ content: text, event_type: "created" });
    expect(context.knowledge.evidence(context.owner, exposure.knowledge_id)).toEqual([]);
  });
});
