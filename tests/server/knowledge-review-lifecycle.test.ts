import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  canonicalPost,
  createBackendHarness,
  type Json,
  makeClient,
  post,
} from "./backend-harness.js";

const harness = createBackendHarness();

const importedKnowledge = (payload: Json): { readonly id: string; readonly revisionId: string } => {
  const parsed = z
    .object({
      imported: z.tuple([
        z.object({
          item: z.object({ id: z.string().uuid() }),
          revision: z.object({ id: z.string().uuid() }),
        }),
      ]),
    })
    .parse(payload);
  return { id: parsed.imported[0].item.id, revisionId: parsed.imported[0].revision.id };
};

describe("knowledge review lifecycle", () => {
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  it("keeps canonical review status learner-scoped and excludes only that learner's incorrect revision", async () => {
    // Given
    const { app, client } = harness.setup();
    await client.call("/api/auth/local-signup", post({ displayName: "Reviewer" }));
    const imported = importedKnowledge(
      await client.json(
        "/api/knowledge/import",
        canonicalPost({
          format: "yaml",
          content:
            "source: review-fixture\nitems:\n  - key: orbital-review\n    title: Orbital review\n    statement: An orbit is a repeated path\n",
        }),
      ),
    );
    const other = makeClient(app);
    await other.call("/api/auth/local-signup", post({ displayName: "Other learner" }));

    // When
    const response = await client.call(
      `/api/knowledge/${imported.id}/reviews`,
      post({ revision: 1, action: "mark_incorrect", reason: "The definition omits gravity." }),
    );

    // Then
    expect(response.status).toBe(201);
    expect((await client.json(`/api/knowledge/${imported.id}`))["reviewStatus"]).toMatchObject({
      status: "incorrect",
      revision: 1,
      reason: "The definition omits gravity.",
    });
    expect((await client.json("/api/search?q=orbit")).results).toEqual([]);
    expect((await other.json("/api/search?q=orbit")).results).toHaveLength(1);
    expect((await other.json(`/api/knowledge/${imported.id}`))["reviewStatus"]).toMatchObject({
      status: "unreviewed",
      revision: 1,
    });
  });

  it("requires reasons for incorrect and retire actions and returns 404 for inaccessible knowledge", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const created = await client.json(
      "/api/knowledge",
      post({ title: "Local unit", statement: "A provisional definition" }),
    );
    const id = z.object({ id: z.string().uuid() }).parse(created.item).id;

    // When
    const incorrect = await client.call(
      `/api/knowledge/${id}/reviews`,
      post({ revision: 1, action: "mark_incorrect" }),
    );
    const retired = await client.call(
      `/api/knowledge/${id}/reviews`,
      post({ revision: 1, action: "retire" }),
    );
    const nullIncorrect = await client.call(
      `/api/knowledge/${id}/reviews`,
      post({ revision: 1, action: "mark_incorrect", reason: null }),
    );
    const nullRetired = await client.call(
      `/api/knowledge/${id}/reviews`,
      post({ revision: 1, action: "retire", reason: null }),
    );
    const missing = await client.call(
      "/api/knowledge/00000000-0000-4000-8000-000000000000/reviews",
      post({ revision: 1, action: "reviewed" }),
    );

    // Then
    expect(incorrect.status).toBe(422);
    expect(retired.status).toBe(422);
    expect(nullIncorrect.status).toBe(422);
    expect(nullRetired.status).toBe(422);
    expect(missing.status).toBe(404);
  });

  it("keeps retirement at unit level until confirmed restore while new revisions start unreviewed", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const first = importedKnowledge(
      await client.json(
        "/api/knowledge/import",
        canonicalPost({
          format: "yaml",
          content:
            "source: lifecycle-v1\nitems:\n  - key: lifecycle\n    title: Lifecycle\n    statement: First definition\n",
        }),
      ),
    );
    await client.call(
      `/api/knowledge/${first.id}/reviews`,
      post({ revision: 1, action: "reviewed" }),
    );
    await client.call(
      `/api/knowledge/${first.id}/reviews`,
      post({ revision: 1, action: "retire", reason: "No longer relevant." }),
    );
    await client.call(
      "/api/knowledge/import",
      canonicalPost({
        format: "yaml",
        content:
          "source: lifecycle-v2\nitems:\n  - key: lifecycle\n    title: Lifecycle\n    statement: Second definition\n",
      }),
    );

    // When
    const beforeRestore = await client.json(`/api/knowledge/${first.id}`);
    const unconfirmed = await client.call(
      `/api/knowledge/${first.id}/reviews`,
      post({ revision: 2, action: "restore", confirmed: false }),
    );
    const restored = await client.call(
      `/api/knowledge/${first.id}/reviews`,
      post({ revision: 2, action: "restore", confirmed: true }),
    );

    // Then
    expect(beforeRestore["reviewStatus"]).toMatchObject({ status: "retired", revision: 2 });
    expect(unconfirmed.status).toBe(422);
    expect(restored.status).toBe(201);
    const detail = await client.json(`/api/knowledge/${first.id}`);
    expect(detail["reviewStatus"]).toMatchObject({ status: "unreviewed", revision: 2 });
    expect(detail["reviewHistory"]).toHaveLength(3);
    expect((await client.json("/api/search?q=Second")).results).toHaveLength(1);
  });

  it("creates an unreviewed correction revision while preserving evidence on the prior revision", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const conversation = await client.json("/api/conversations", post({ title: "Correction" }));
    const conversationId = z
      .object({ conversation: z.object({ id: z.string() }) })
      .parse(conversation).conversation.id;
    const message = await client.json(
      `/api/conversations/${conversationId}/messages`,
      post({ content: "original learner evidence" }),
    );
    const messageId = z.object({ message: z.object({ id: z.string() }) }).parse(message).message.id;
    const created = await client.json(
      "/api/knowledge",
      post({ title: "Editable unit", statement: "First definition" }),
    );
    const parsed = z
      .object({
        item: z.object({ id: z.string() }),
        revision: z.object({ id: z.string() }),
      })
      .parse(created);
    await client.call(
      `/api/knowledge/${parsed.item.id}/reviews`,
      post({ revision: 1, action: "reviewed" }),
    );
    await client.call(
      "/api/evidence",
      post({
        knowledgeId: parsed.item.id,
        knowledgeRevisionId: parsed.revision.id,
        revision: 1,
        conversationId,
        messageId,
        dimension: "explanation",
        evidenceType: "free_explanation",
        score: 0.8,
        polarity: "positive",
        evaluatorConfidence: 1,
        evaluator: { type: "human", rubricVersion: "manual-v1" },
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

    // When
    const response = await client.call(
      "/api/corrections",
      post({
        knowledgeId: parsed.item.id,
        revision: 1,
        statement: "Corrected definition",
        reason: "The original was incomplete.",
        kind: "revise",
      }),
    );

    // Then
    expect(response.status).toBe(201);
    const detail = await client.json(`/api/knowledge/${parsed.item.id}`);
    expect(detail["reviewStatus"]).toMatchObject({ status: "unreviewed", revision: 2 });
    expect(detail["revisions"]).toHaveLength(2);
    expect(
      z.array(z.object({ knowledgeRevisionId: z.string() })).parse(detail["evidence"])[0]
        ?.knowledgeRevisionId,
    ).toBe(parsed.revision.id);
  });

  it("exports immutable review history and removes only the erased learner's events", async () => {
    // Given
    const { app, client, database } = harness.setup();
    await client.call("/api/auth/local-signup", post({ displayName: "First" }));
    const imported = importedKnowledge(
      await client.json(
        "/api/knowledge/import",
        canonicalPost({
          format: "yaml",
          content:
            "source: export-review\nitems:\n  - key: export-review\n    title: Export review\n    statement: Shared definition\n",
        }),
      ),
    );
    await client.call(
      `/api/knowledge/${imported.id}/reviews`,
      post({ revision: 1, action: "reviewed" }),
    );
    const other = makeClient(app);
    await other.call("/api/auth/local-signup", post({ displayName: "Second" }));
    await other.call(
      `/api/knowledge/${imported.id}/reviews`,
      post({ revision: 1, action: "retire", reason: "Second learner does not need this." }),
    );
    const exported = await client.json("/api/export");
    const eventId = z
      .array(z.object({ id: z.string().uuid() }))
      .parse(exported["knowledgeReviewEvents"])[0]?.id;

    // When / Then
    expect(eventId).toBeDefined();
    if (eventId === undefined) return;
    expect(() =>
      database.run("UPDATE knowledge_review_events SET reason=? WHERE id=?", ["changed", eventId]),
    ).toThrow("knowledge review events are immutable");
    expect(() => database.run("DELETE FROM knowledge_review_events WHERE id=?", [eventId])).toThrow(
      "knowledge review events are immutable",
    );
    expect((await client.call("/api/privacy", { method: "DELETE" })).status).toBe(204);
    expect((await other.json("/api/export"))["knowledgeReviewEvents"]).toHaveLength(1);
  });
});
