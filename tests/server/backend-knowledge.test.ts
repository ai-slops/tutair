import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalPost,
  createBackendHarness,
  type Json,
  makeClient,
  post,
  scripted,
} from "./backend-harness.js";

describe("Phase 1 knowledge backend", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);
  it("imports immutable canonical YAML and creates revisions on reimport", async () => {
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const yaml =
      "source: book-v1\nitems:\n  - key: gravity\n    title: Gravity\n    statement: Objects attract\n";
    const first = await client.json(
      "/api/knowledge/import",
      canonicalPost({ format: "yaml", content: yaml }),
    );
    const id = (((first.imported as unknown[])[0] as Json).item as Json).id;
    await client.call(
      "/api/knowledge/import",
      canonicalPost({ format: "yaml", content: yaml.replace("attract", "mutually attract") }),
    );
    expect((await client.json(`/api/knowledge/${id}`)).revisions).toHaveLength(2);
  });
  it("accepts only learner evidence and discounts assisted ambiguous evidence", async () => {
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const conversation = await client.json("/api/conversations", post({}));
    const conversationId = (conversation.conversation as Json).id;
    const message = await client.json(
      `/api/conversations/${conversationId}/messages`,
      post({ content: "I can explain it" }),
    );
    const messageId = (message.message as Json).id;
    const knowledge = await client.json(
      "/api/knowledge",
      post({ title: "Topic", statement: "Fact", confidence: 0.5 }),
    );
    const knowledgeId = (knowledge.item as Json).id;
    const evidence = await client.json(
      "/api/evidence",
      post({
        knowledgeId,
        revision: 1,
        messageId,
        polarity: "positive",
        strength: 1,
        assistance: "worked_example",
        confidence: 0,
        ambiguous: true,
        copied: true,
      }),
    );
    expect((evidence.evidence as Json).weight).toBeLessThan(0.2);
  });
  it("does not transfer evidence across revisions", async () => {
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const conversation = await client.json("/api/conversations", post({}));
    const cid = (conversation.conversation as Json).id;
    const message = await client.json(
      `/api/conversations/${cid}/messages`,
      post({ content: "proof" }),
    );
    const mid = (message.message as Json).id;
    const knowledge = await client.json(
      "/api/knowledge",
      post({ title: "Topic", statement: "v1" }),
    );
    const kid = (knowledge.item as Json).id;
    await client.call(
      "/api/evidence",
      post({
        knowledgeId: kid,
        revision: 1,
        messageId: mid,
        dimension: "application",
        polarity: "positive",
        strength: 1,
      }),
    );
    const before = await client.json("/api/export");
    const state = before.learnerState as Json[];
    expect(state.find((row) => row.dimension === "application")?.status).toBe("tentative");
    expect(state.find((row) => row.dimension === "explanation")?.status).toBe("unknown");
    await client.call(
      "/api/corrections",
      post({ knowledgeId: kid, revision: 1, statement: "v2", reason: "changed" }),
    );
    await client.call("/api/evidence/rebuild", post({ knowledgeId: kid }));
    expect(((await client.json(`/api/knowledge/${kid}`)).item as Json).mastery).toBe(0);
  });
  it("reports honest FTS-only and hybrid search modes", async () => {
    const { client } = harness.setup(scripted(true));
    await client.call("/api/auth/local-signup", post({}));
    await client.call(
      "/api/knowledge",
      post({ title: "Gravity", statement: "gravity attracts masses" }),
    );
    const result = await client.json("/api/search?q=gravity");
    expect(result.mode).toBe("hybrid");
    expect(result.results).toHaveLength(1);
  });
  it("preserves exact revision and source snapshots with complete evidence provenance", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const conversation = await client.json("/api/conversations", post({ title: "Evidence" }));
    const conversationId = (conversation.conversation as Json).id;
    const message = await client.json(
      `/api/conversations/${conversationId}/messages`,
      post({ content: "original explanation" }),
    );
    const messageId = (message.message as Json).id;
    const knowledge = await client.json(
      "/api/knowledge",
      post({ title: "State", statement: "revision one" }),
    );
    const knowledgeId = (knowledge.item as Json).id;
    const revisionId = (knowledge["revision"] as Json).id;

    // When
    await client.call(
      "/api/evidence",
      post({
        knowledgeId,
        knowledgeRevisionId: revisionId,
        revision: 1,
        conversationId,
        messageId,
        dimension: "application",
        evidenceType: "application",
        score: 0.9,
        polarity: "positive",
        evaluatorConfidence: 0.8,
        evaluator: { type: "model", modelRunId: null, rubricVersion: "rubric-v3" },
        assistance: {
          hints: 2,
          answerVisible: false,
          openBook: true,
          copiedFromRecentContext: false,
        },
        supportingSpans: [{ start: 0, end: 8 }],
        limitations: ["single example"],
        relatedUnitIds: [],
        difficulty: 0.7,
      }),
    );
    await client.call(`/api/conversations/${conversationId}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content: "edited explanation" }),
    });
    await client.call(
      "/api/corrections",
      post({ knowledgeId, revision: 1, statement: "revision two", reason: "scope changed" }),
    );

    // Then
    const exported = await client.json("/api/export");
    const evidence = (exported.evidence as Json[])[0];
    expect(evidence).toMatchObject({
      knowledgeRevisionId: revisionId,
      conversationId,
      evidenceType: "application",
      score: 0.9,
      evaluatorConfidence: 0.8,
      evaluatorType: "model",
      rubricVersion: "rubric-v3",
      hints: 2,
      answerVisible: 0,
      openBook: 1,
      copiedFromRecentContext: 0,
      supportingSpans: [{ start: 0, end: 8 }],
      limitations: ["single example"],
      difficulty: 0.7,
    });
    expect(exported["messageEvents"]).toHaveLength(2);
    expect(evidence?.["messageEventId"]).toBe((exported["messageEvents"] as Json[])[0]?.id);
    expect((exported.revisions as Json[]).map((row) => row.id)).toContain(revisionId);
  });

  it("keeps application evidence out of every other mastery dimension", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const conversation = await client.json("/api/conversations", post({}));
    const conversationId = (conversation.conversation as Json).id;
    const message = await client.json(
      `/api/conversations/${conversationId}/messages`,
      post({ content: "applied it" }),
    );
    const knowledge = await client.json(
      "/api/knowledge",
      post({ title: "Machine", statement: "A machine changes state" }),
    );

    // When
    await client.call(
      "/api/evidence",
      post({
        knowledgeId: (knowledge.item as Json).id,
        knowledgeRevisionId: (knowledge["revision"] as Json).id,
        revision: 1,
        conversationId,
        messageId: (message.message as Json).id,
        dimension: "application",
        evidenceType: "application",
        score: 1,
        polarity: "positive",
        evaluatorConfidence: 1,
        evaluator: { type: "human", rubricVersion: "application-v1" },
        assistance: {
          hints: 0,
          answerVisible: false,
          openBook: false,
          copiedFromRecentContext: false,
        },
        supportingSpans: [],
        limitations: [],
        relatedUnitIds: [],
      }),
    );

    // Then
    const state = (await client.json("/api/export")).learnerState as Json[];
    expect(
      state.find((row) => row.dimension === "application")?.["effectiveEvidence"],
    ).toBeGreaterThan(0);
    expect(
      state
        .filter((row) => row.dimension !== "application")
        .every((row) => row["effectiveEvidence"] === 0),
    ).toBe(true);
  });
  it("exports then erases only the active learner", async () => {
    const { client, app } = harness.setup();
    await client.call("/api/auth/local-signup", post({ displayName: "Erase" }));
    await client.call("/api/conversations", post({ title: "Mine" }));
    expect((await client.json("/api/export")).conversations).toHaveLength(1);
    const other = makeClient(app);
    await other.call("/api/auth/local-signup", post({ displayName: "Keep" }));
    await other.call("/api/conversations", post({ title: "Safe" }));
    expect((await client.call("/api/privacy", { method: "DELETE" })).status).toBe(204);
    expect((await other.json("/api/conversations")).conversations).toHaveLength(1);
  });
});
