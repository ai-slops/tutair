import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CoreRepository } from "../../src/server/repository-core.js";
import { createBackendHarness, type Json, makeClient, post } from "./backend-harness.js";

describe("LearningThread lifecycle", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  it("persists distinct thread metadata and promotes targets out of deferred units", async () => {
    // Given
    const { client } = harness.setup();
    const signup = await client.json("/api/auth/local-signup", post({ displayName: "Ada" }));
    const learnerId = (signup["learner"] as Json).id;
    const first = await client.json(
      "/api/knowledge",
      post({ title: "State", statement: "A state is a configuration." }),
    );
    const second = await client.json(
      "/api/knowledge",
      post({ title: "Transition", statement: "A transition changes state." }),
    );
    const targetId = (first.item as Json).id;
    const deferredId = (second.item as Json).id;

    // When
    const response = await client.call(
      "/api/threads",
      post({
        title: "FSM project",
        goal: "Implement the next transition",
        origin: "project",
        whyNow: "Needed for a prototype",
        desiredOutcome: "Build and explain a correct FSM",
        targetKnowledgeUnitIds: [targetId],
        deferredKnowledgeUnitIds: [targetId, deferredId],
      }),
    );

    // Then
    expect(response.status).toBe(201);
    const thread = ((await response.json()) as Json).thread as Json;
    expect(thread).toMatchObject({
      learnerId,
      origin: "project",
      whyNow: "Needed for a prototype",
      desiredOutcome: "Build and explain a correct FSM",
      status: "open",
      targetKnowledgeUnitIds: [targetId],
      deferredKnowledgeUnitIds: [deferredId],
    });
  });

  it("accepts status aliases and records question transitions without duplicates", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const created = await client.json(
      "/api/threads",
      post({ title: "Limits", goal: "Understand limits" }),
    );
    const threadId = (created.thread as Json).id;
    const first = await client.json(
      `/api/threads/${threadId}/questions`,
      post({ text: "What is convergence?" }),
    );
    const questionId = (first["question"] as Json).id;

    // When
    const duplicate = await client.json(
      `/api/threads/${threadId}/questions`,
      post({ text: "  what IS convergence?  " }),
    );
    const transitioned = await client.call(`/api/threads/${threadId}/questions/${questionId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "parked" }),
    });
    const parked = await client.call(`/api/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "parked" }),
    });
    const active = await client.call(`/api/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active" }),
    });

    // Then
    expect((duplicate["question"] as Json).id).toBe(questionId);
    expect(transitioned.status).toBe(200);
    expect((((await transitioned.json()) as Json)["question"] as Json).status).toBe("parked");
    expect((((await parked.json()) as Json).thread as Json).status).toBe("paused");
    expect((((await active.json()) as Json).thread as Json).status).toBe("open");
    const detail = await client.json(`/api/threads/${threadId}`);
    expect(detail["openQuestions"]).toHaveLength(1);
    expect(detail["events"]).toHaveLength(3);
    expect(detail["questionEvents"]).toHaveLength(2);
  });

  it("rejects knowledge units outside the learner and canonical scopes", async () => {
    // Given
    const { client, app } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const other = makeClient(app);
    await other.call("/api/auth/local-signup", post({}));
    const created = await other.json(
      "/api/knowledge",
      post({ title: "Private", statement: "Another learner's unit." }),
    );

    // When
    const response = await client.call(
      "/api/threads",
      post({
        title: "Invalid target",
        goal: "Do not cross scopes",
        targetKnowledgeUnitIds: [(created.item as Json).id],
      }),
    );

    // Then
    expect(response.status).toBe(422);
  });

  it("clears closed current selections and only explicit resume can reopen them", async () => {
    // Given
    const { client, database } = harness.setup();
    const signup = await client.json("/api/auth/local-signup", post({}));
    const owner = (signup["learner"] as Json).id as string;
    const createdConversation = await client.json("/api/conversations", post({ title: "Session" }));
    const conversationId = (createdConversation.conversation as Json).id as string;
    const created = await client.json(
      "/api/threads",
      post({ title: "FSM", goal: "Build it", conversationId }),
    );
    const threadId = (created.thread as Json).id as string;

    // When
    await client.call(`/api/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "parked" }),
    });

    // Then
    expect(database.raw.prepare("SELECT COUNT(*) AS count FROM current_threads").get()).toEqual({
      count: 0,
    });
    expect(() =>
      new CoreRepository(database).selectThread(owner, conversationId, threadId, "unique_decisive"),
    ).toThrow(/not open/i);
    const stillParked = await client.json(`/api/threads/${threadId}`);
    expect((stillParked.thread as Json).status).toBe("paused");
    const resumed = await client.json(`/api/threads/${threadId}/resume`, post({ conversationId }));
    expect((resumed.thread as Json).status).toBe("open");
  });

  it("preserves complete metadata snapshots in immutable thread events", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const created = await client.json(
      "/api/threads",
      post({
        title: "Initial",
        goal: "First goal",
        origin: "question",
        whyNow: "Today",
        desiredOutcome: "Durable outcome",
      }),
    );
    const threadId = (created.thread as Json).id;

    // When
    await client.call(`/api/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({
        origin: "project",
        whyNow: "Deadline",
        desiredOutcome: "Ship a working artifact",
      }),
    });

    // Then
    const detail = await client.json(`/api/threads/${threadId}`);
    const events = detail["events"] as Json[];
    expect((events[0]?.["data"] as Json | undefined)?.["thread"]).toMatchObject({
      origin: "question",
      whyNow: "Today",
      desiredOutcome: "Durable outcome",
      targetKnowledgeUnitIds: [],
      deferredKnowledgeUnitIds: [],
    });
    expect(events[1]?.["data"]).toMatchObject({
      before: { origin: "question", whyNow: "Today", desiredOutcome: "Durable outcome" },
      after: {
        origin: "project",
        whyNow: "Deadline",
        desiredOutcome: "Ship a working artifact",
      },
    });
  });
});
