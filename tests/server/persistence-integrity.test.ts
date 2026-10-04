import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CoreRepository } from "../../src/server/repository-core.js";
import { createBackendHarness, type Json, makeClient, post } from "./backend-harness.js";

const createdKnowledge = async (client: ReturnType<typeof makeClient>, title: string) => {
  const created = await client.json(
    "/api/knowledge",
    post({ title, statement: `${title} definition` }),
  );
  return z
    .object({ item: z.object({ id: z.string() }), revision: z.object({ id: z.string() }) })
    .parse(created);
};

describe("correction and projection persistence integrity", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  it("rejects a correction source message owned by another learner", async () => {
    // Given
    const { client, app } = harness.setup();
    await client.call("/api/auth/local-signup", post({ displayName: "owner" }));
    const knowledge = await createdKnowledge(client, "Owner topic");
    const other = makeClient(app);
    await other.call("/api/auth/local-signup", post({ displayName: "other" }));
    const conversation = await other.json("/api/conversations", post({}));
    const message = await other.json(
      `/api/conversations/${(conversation.conversation as Json).id}/messages`,
      post({ content: "other learner message" }),
    );

    // When
    const response = await client.call(
      "/api/corrections",
      post({
        knowledgeId: knowledge.item.id,
        revision: 1,
        statement: "changed",
        reason: "source test",
        messageId: (message.message as Json).id,
      }),
    );

    // Then
    expect(response.status).toBe(422);
    expect((await client.json(`/api/knowledge/${knowledge.item.id}`)).revisions).toHaveLength(1);
  });

  it("rolls back a correction when an evidence reference is not scoped to its revision", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const knowledge = await createdKnowledge(client, "Rollback topic");
    const missingEvidenceId = "00000000-0000-4000-8000-000000000001";

    // When
    const response = await client.call(
      "/api/corrections",
      post({
        knowledgeId: knowledge.item.id,
        revision: 1,
        statement: "changed",
        reason: "bad evidence",
        evidenceIds: [missingEvidenceId],
      }),
    );

    // Then
    expect(response.status).toBe(422);
    expect((await client.json(`/api/knowledge/${knowledge.item.id}`)).revisions).toHaveLength(1);
    expect((await client.json("/api/export"))["corrections"]).toEqual([]);
  });

  it("records claim-more against the same immutable definition revision", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const knowledge = await createdKnowledge(client, "Claim topic");

    // When
    const response = await client.call(
      "/api/corrections",
      post({
        knowledgeId: knowledge.item.id,
        revision: 1,
        statement: "I know more than shown",
        reason: "self report",
        kind: "claim_more",
      }),
    );

    // Then
    expect(response.status).toBe(201);
    const detail = await client.json(`/api/knowledge/${knowledge.item.id}`);
    expect(detail.revisions).toHaveLength(1);
    expect(await response.json()).toMatchObject({
      correction: { fromRevision: 1, toRevision: 1 },
    });
  });

  it("records claim-less against the same immutable definition revision", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const knowledge = await createdKnowledge(client, "Lower claim topic");

    // When
    const response = await client.call(
      "/api/corrections",
      post({
        knowledgeId: knowledge.item.id,
        revision: 1,
        statement: "I know less than shown",
        reason: "self report",
        kind: "claim_less",
      }),
    );

    // Then
    expect(response.status).toBe(201);
    expect((await client.json(`/api/knowledge/${knowledge.item.id}`)).revisions).toHaveLength(1);
    expect(await response.json()).toMatchObject({ correction: { fromRevision: 1, toRevision: 1 } });
  });

  it("returns versioned inspectable state for exposure without mastery evidence", async () => {
    // Given
    const { client, database } = harness.setup();
    const signup = await client.json("/api/auth/local-signup", post({}));
    const learnerId = z.object({ learner: z.object({ id: z.string() }) }).parse(signup).learner.id;
    const knowledge = await createdKnowledge(client, "Exposure topic");
    const core = new CoreRepository(database);
    const conversation = z
      .object({ id: z.string() })
      .parse(core.createConversation(learnerId, "Exposure", null));
    const message = z
      .object({ id: z.string() })
      .parse(core.createMessage(learnerId, conversation.id, "tutor", "Exposure topic definition"));
    const event = z
      .object({ id: z.string() })
      .parse(
        database.one(
          "SELECT id FROM message_events WHERE message_id=?",
          [message.id],
          z.object({ id: z.string() }),
        ),
      );
    database.run(
      "INSERT INTO exposures(id,learner_id,knowledge_id,revision,message_id,created_at,knowledge_revision_id,message_event_id,provenance) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        "00000000-0000-4000-8000-000000000002",
        learnerId,
        knowledge.item.id,
        1,
        message.id,
        "2026-09-19T00:00:00.000Z",
        knowledge.revision.id,
        event.id,
        "generation_snapshot",
      ],
    );

    // When
    await client.call("/api/evidence/rebuild", post({ knowledgeId: knowledge.item.id }));
    const detail = await client.json(`/api/knowledge/${knowledge.item.id}`);

    // Then
    const state = z
      .array(
        z.object({
          dimension: z.string(),
          status: z.string(),
          effectiveEvidence: z.number(),
          evidenceIds: z.array(z.string()),
          knowledgeRevisionId: z.string(),
          projectionVersion: z.string(),
        }),
      )
      .parse(detail.learnerState);
    expect(state.find((row) => row.dimension === "recognition")?.status).toBe("exposed");
    expect(state.find((row) => row.dimension === "explanation")).toMatchObject({
      status: "unknown",
      effectiveEvidence: 0,
      evidenceIds: [],
      knowledgeRevisionId: knowledge.revision.id,
      projectionVersion: "weighted-revision-dimensions-v2-risk",
    });
  });
});
