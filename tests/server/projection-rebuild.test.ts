import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CoreRepository } from "../../src/server/repository-core.js";
import { loadTutorContext } from "../../src/server/tutor-context.js";
import { createBackendHarness, makeClient, post } from "./backend-harness.js";

const stateSchema = z.array(
  z.object({
    knowledgeRevisionId: z.string(),
    revision: z.number(),
    dimension: z.string(),
    estimate: z.number(),
    uncertainty: z.number(),
    status: z.string(),
    effectiveEvidence: z.number(),
    evidenceIds: z.array(z.string()),
    projectionVersion: z.string(),
  }),
);

describe("historical projection reconstruction", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  const historicalTopic = async () => {
    const context = harness.setup();
    const { client } = context;
    const signup = z
      .object({ learner: z.object({ id: z.string() }) })
      .parse(await client.json("/api/auth/local-signup", post({})));
    const conversation = z
      .object({ conversation: z.object({ id: z.string() }) })
      .parse(await client.json("/api/conversations", post({})));
    const turn = z
      .object({ knowledgeChanges: z.array(z.object({ item: z.object({ id: z.string() }) })) })
      .parse(
        await client.json(
          `/api/conversations/${conversation.conversation.id}/tutor-turn`,
          post({ content: "Explain the claim" }),
        ),
      );
    const knowledgeId = z.string().parse(turn.knowledgeChanges[0]?.item.id);
    const message = z
      .object({ message: z.object({ id: z.string() }) })
      .parse(
        await client.json(
          `/api/conversations/${conversation.conversation.id}/messages`,
          post({ content: "I can apply the claim to this example" }),
        ),
      );
    const evidence = z.object({ evidence: z.object({ id: z.string() }) }).parse(
      await client.json(
        "/api/evidence",
        post({
          knowledgeId,
          revision: 1,
          messageId: message.message.id,
          dimension: "application",
          evidenceType: "application",
          score: 1,
          polarity: "positive",
          evaluatorConfidence: 1,
        }),
      ),
    );
    const prior = stateSchema.parse(
      (await client.json(`/api/knowledge/${knowledgeId}/revisions/1`)).learnerState,
    );
    const revised = await client.call(
      "/api/corrections",
      post({ knowledgeId, revision: 1, statement: "A revised claim", reason: "Refine definition" }),
    );
    expect(revised.status).toBe(201);
    return {
      ...context,
      knowledgeId,
      owner: signup.learner.id,
      conversationId: conversation.conversation.id,
      messageId: message.message.id,
      evidenceId: evidence.evidence.id,
      prior,
    };
  };

  it.each(["unit", "learner"] as const)(
    "restores historical evidence and exposure after projection loss with a %s rebuild",
    async (scope) => {
      // Given: only derived state is lost; both immutable revisions and their sources remain.
      const { client, database, knowledgeId, owner, prior } = await historicalTopic();
      database.run("DELETE FROM learner_state WHERE learner_id=?", [owner]);

      // When
      const result = await client.json(
        "/api/evidence/rebuild",
        post(scope === "unit" ? { knowledgeId } : {}),
      );

      // Then: rebuild counts units, retains revision-local exposure, and never migrates mastery.
      expect(result["rebuilt"]).toBe(1);
      const historical = stateSchema.parse(
        (await client.json(`/api/knowledge/${knowledgeId}/revisions/1`)).learnerState,
      );
      expect(historical).toEqual(prior);
      expect(historical.find((state) => state.dimension === "recognition")?.status).toBe("exposed");
      expect(historical.find((state) => state.dimension === "application")?.effectiveEvidence).toBe(
        1,
      );
      const current = await client.json(`/api/knowledge/${knowledgeId}`);
      expect(current.item).toMatchObject({ mastery: 0, confidence: 0, currentRevision: 2 });
      expect(stateSchema.parse(current.learnerState)).toHaveLength(6);
      expect(
        stateSchema.parse(current.learnerState).every((state) => state.status === "unknown"),
      ).toBe(true);
    },
  );

  it("applies a later invalidation to its historical revision without deleting the evidence", async () => {
    // Given
    const { client, knowledgeId, evidenceId } = await historicalTopic();

    // When
    const response = await client.call(
      "/api/corrections",
      post({
        knowledgeId,
        revision: 1,
        kind: "invalidate_evidence",
        targetType: "evidence",
        targetId: evidenceId,
        evidenceIds: [evidenceId],
        statement: "That answer was a guess",
        reason: "Learner correction",
      }),
    );

    // Then
    expect(response.status).toBe(201);
    const historical = await client.json(`/api/knowledge/${knowledgeId}/revisions/1`);
    expect(historical.evidence).toHaveLength(1);
    const states = stateSchema.parse(historical.learnerState);
    expect(states.find((state) => state.dimension === "application")).toMatchObject({
      status: "unknown",
      effectiveEvidence: 0,
      evidenceIds: [],
    });
    expect(states.find((state) => state.dimension === "recognition")?.status).toBe("exposed");
  });

  it("does not rebuild another learner's historical projections", async () => {
    // Given
    const { client, app, database, knowledgeId, owner } = await historicalTopic();
    const other = makeClient(app);
    await other.call("/api/auth/local-signup", post({}));
    database.run("DELETE FROM learner_state WHERE learner_id=?", [owner]);

    // When
    const response = await other.call("/api/evidence/rebuild", post({ knowledgeId }));

    // Then
    expect(response.status).toBe(404);
    expect((await client.json(`/api/knowledge/${knowledgeId}/revisions/1`)).learnerState).toEqual(
      [],
    );
  });

  it("uses only current-revision state in tutor context even when historical state was rebuilt later", async () => {
    // Given
    const { database, owner, conversationId, messageId } = await historicalTopic();
    database.run("UPDATE learner_state SET projected_at=? WHERE learner_id=? AND revision=1", [
      "2099-01-01T00:00:00.000Z",
      owner,
    ]);

    // When
    const context = loadTutorContext(
      database,
      new CoreRepository(database),
      {
        owner,
        conversationId,
        messageId,
        content: "Continue",
        assistance: "none",
        selfReport: "neutral",
      },
      [],
    );

    // Then
    const states = z
      .array(z.object({ revision: z.number(), status: z.string() }))
      .parse(context.learnerStates);
    expect(states).toHaveLength(6);
    expect(states.every((state) => state.revision === 2 && state.status === "unknown")).toBe(true);
  });
});
