import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  canonicalPost,
  createBackendHarness,
  type Json,
  makeClient,
  post,
} from "./backend-harness.js";

describe("Phase 1 persistence boundaries", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  it("rejects canonical imports without authority credentials", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));

    // When
    const response = await client.call(
      "/api/knowledge/import",
      post({
        format: "yaml",
        content: "source: untrusted\nitems:\n  - key: bad\n    title: Bad\n    statement: Bad\n",
      }),
    );

    // Then
    expect(response.status).toBe(403);
    expect((await client.json("/api/knowledge?scope=canonical"))["items"]).toEqual([]);
  });

  it("stores relation endpoints at exact immutable revisions", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const yaml = `source: reference-v1
items:
  - key: state
    title: State
    statement: A remembered configuration
  - key: transition
    title: Transition
    statement: A change between states
    relations:
      - to: state
        kind: prerequisite
        necessity: required
        scaffoldable: true
`;

    // When
    const imported = await client.json(
      "/api/knowledge/import",
      canonicalPost({ format: "yaml", content: yaml }),
    );

    // Then
    const exported = await client.json("/api/export");
    const relation = (exported["relations"] as Json[])[0];
    const entries = z
      .array(
        z.object({ item: z.object({ id: z.string() }), revision: z.object({ id: z.string() }) }),
      )
      .parse(imported.imported);
    const state = entries[0];
    const transition = entries[1];
    expect(state).toBeDefined();
    expect(transition).toBeDefined();
    if (state === undefined || transition === undefined) return;
    expect(relation).toMatchObject({
      fromKnowledgeId: transition.item.id,
      toKnowledgeId: state.item.id,
      fromRevisionId: transition.revision.id,
      toRevisionId: state.revision.id,
      kind: "prerequisite",
      necessity: "required",
      scaffoldable: 1,
    });
  });

  it("rejects a canonical key reimport with a different semantic scope", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const first = await client.json(
      "/api/knowledge/import",
      canonicalPost({
        format: "yaml",
        content:
          "source: glossary-a\nitems:\n  - key: formal\n    title: Formal\n    statement: Ceremonial\n    semanticScope: social ceremony\n",
      }),
    );
    const knowledgeId = z
      .object({
        imported: z.tuple([z.object({ item: z.object({ id: z.string() }) })]).rest(z.unknown()),
      })
      .parse(first).imported[0].item.id;

    // When
    const response = await client.call(
      "/api/knowledge/import",
      canonicalPost({
        format: "yaml",
        content:
          "source: glossary-b\nitems:\n  - key: formal\n    title: Formal\n    statement: Mathematically specified\n    semanticScope: formal system\n",
      }),
    );

    // Then
    expect(response.status).toBe(409);
    expect((await client.json(`/api/knowledge/${knowledgeId}`)).revisions).toHaveLength(1);
  });

  it("creates a distinct unit for a reported meaning mismatch", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const created = await client.json(
      "/api/knowledge",
      post({ title: "Formal", statement: "Ceremonial" }),
    );
    const originalId = (created.item as Json).id;

    // When
    const corrected = await client.json(
      "/api/corrections",
      post({
        knowledgeId: originalId,
        revision: 1,
        statement: "Specified by a formal system",
        reason: "different sense",
        kind: "meaning_mismatch",
      }),
    );

    // Then
    expect((corrected.item as Json).id).not.toBe(originalId);
    expect((await client.json(`/api/knowledge/${originalId}`)).revisions).toHaveLength(1);
    expect((await client.json("/api/knowledge?scope=provisional"))["items"]).toHaveLength(2);
  });

  it("rejects normal mutation of an immutable revision", async () => {
    // Given
    const { client, database } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const created = await client.json(
      "/api/knowledge",
      post({ title: "Immutable", statement: "Original" }),
    );
    const revisionId = z.object({ id: z.string() }).parse(created["revision"]).id;

    // When / Then
    expect(() =>
      database.run("UPDATE knowledge_revisions SET statement=? WHERE id=?", [
        "mutated",
        revisionId,
      ]),
    ).toThrow("knowledge revisions are immutable");
  });

  it("retains every conversation link when a thread resumes", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const first = await client.json("/api/conversations", post({ title: "First" }));
    const second = await client.json("/api/conversations", post({ title: "Second" }));
    const thread = await client.json(
      "/api/threads",
      post({
        title: "State machines",
        goal: "Understand transitions",
        conversationId: (first.conversation as Json).id,
      }),
    );
    const threadId = (thread.thread as Json).id;

    // When
    await client.call(
      `/api/threads/${threadId}/resume`,
      post({ conversationId: (second.conversation as Json).id }),
    );

    // Then
    const detail = await client.json(`/api/threads/${threadId}`);
    expect(detail.conversations).toHaveLength(2);
    expect(detail["events"]).toHaveLength(2);
    expect(
      (await client.json(`/api/conversations/${(second.conversation as Json).id}`))["threads"],
    ).toHaveLength(1);
    expect((await client.json("/api/export"))["threadConversations"]).toHaveLength(2);
  });

  it("erases a private graph and session while retaining global canonical knowledge", async () => {
    // Given
    const { client, app } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    await client.call(
      "/api/knowledge/import",
      canonicalPost({
        format: "yaml",
        content:
          "source: public\nitems:\n  - key: public\n    title: Public\n    statement: Shared\n",
      }),
    );
    await client.call("/api/knowledge", post({ title: "Private", statement: "Mine" }));

    // When
    expect((await client.call("/api/privacy", { method: "DELETE" })).status).toBe(204);

    // Then
    expect((await client.call("/api/conversations")).status).toBe(401);
    const other = makeClient(app);
    await other.call("/api/auth/local-signup", post({}));
    const visible = await other.json("/api/knowledge?scope=all");
    expect(visible["items"]).toHaveLength(1);
    expect(((visible["items"] as Json[])[0]?.["title"] as string) ?? "").toBe("Public");
  });
});
