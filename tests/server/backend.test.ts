import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { TutorProvider } from "../../src/server/provider.js";
import { createBackendHarness, type Json, makeClient, post } from "./backend-harness.js";

describe("Phase 1 tutor backend", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);
  it("issues an opaque session and scopes learners", async () => {
    const { client, app } = harness.setup();
    expect((await client.call("/api/session")).status).toBe(401);
    expect((await client.call("/api/auth/local-signup", post({ displayName: "Ada" }))).status).toBe(
      201,
    );
    const capabilities = await client.json("/api/capabilities");
    expect(typeof capabilities.embedding).toBe("boolean");
    expect(typeof capabilities.search).toBe("boolean");
    const other = makeClient(app);
    await other.call("/api/auth/local-signup", post({ displayName: "Lin" }));
    await client.call("/api/conversations", post({ title: "Private" }));
    expect((await other.json("/api/conversations")).conversations).toEqual([]);
  });
  it("rejects malformed and oversized JSON at the HTTP boundary", async () => {
    const { client } = harness.setup();
    const malformed = await client.call("/api/auth/local-signup", { method: "POST", body: "{" });
    expect(malformed.status).toBe(400);
    expect(((await malformed.json()) as Json).error).toEqual({
      code: "invalid_json",
      message: "Request body must be valid JSON",
    });
    expect(
      (await client.call("/api/auth/local-signup", post({ displayName: "x".repeat(1_048_576) })))
        .status,
    ).toBe(413);
  });
  it("retains edit history while tombstoning raw messages", async () => {
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const created = await client.json("/api/conversations", post({}));
    const id = (created.conversation as Json).id;
    const message = await client.json(
      `/api/conversations/${id}/messages`,
      post({ content: "first" }),
    );
    const messageId = (message.message as Json).id;
    await client.call(`/api/conversations/${id}/messages/${messageId}`, {
      method: "PATCH",
      body: JSON.stringify({ content: "second" }),
    });
    expect((await client.json(`/api/conversations/${id}`)).messages).toHaveLength(1);
    expect(
      (await client.call(`/api/conversations/${id}/messages/${messageId}`, { method: "DELETE" }))
        .status,
    ).toBe(204);
    expect((await client.json(`/api/conversations/${id}`)).messages).toEqual([]);
  });
  it("persists learner input when the provider fails", async () => {
    const failed: TutorProvider = {
      embeddingProfile: "disabled:v1",
      state: {
        provider: "disabled",
        model: null,
        generation: false,
        synthetic: false,
        embedding: "disabled",
      },
      async call(): Promise<never> {
        throw new Error("offline");
      },
    };
    const { client } = harness.setup(failed);
    await client.call("/api/auth/local-signup", post({}));
    const created = await client.json("/api/conversations", post({}));
    const id = (created.conversation as Json).id;
    const failedTurn = await client.call(
      `/api/conversations/${id}/tutor-turn`,
      post({ content: "save me" }),
    );
    expect(failedTurn.status).toBe(500);
    const error = (await failedTurn.json()) as Json;
    const messages = (await client.json(`/api/conversations/${id}`)).messages as Json[];
    expect(messages).toHaveLength(1);
    expect((error.error as Json)["details"]).toEqual({ userMessageId: messages[0]?.id });
  });
  it("runs independent scripted stages and visibly marks synthetic output", async () => {
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const created = await client.json("/api/conversations", post({ goal: "Learn" }));
    const id = (created.conversation as Json).id;
    const result = await client.json(
      `/api/conversations/${id}/tutor-turn`,
      post({ content: "Why?", assistance: "hint" }),
    );
    expect(result.synthetic).toBe(true);
    expect((result.run as Json).stages).toBe(8);
    expect((result.tutorMessage as Json).synthetic).toBe(true);
    expect(result.knowledgeChanges).toHaveLength(1);
    const itemId = (((result.knowledgeChanges as unknown[])[0] as Json).item as Json).id;
    const detail = await client.json(`/api/knowledge/${itemId}`);
    expect(detail.evidence).toEqual([]);
    expect(detail.exposures).toHaveLength(1);
  });
  it("resumes a thread into another conversation", async () => {
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const thread = await client.json(
      "/api/threads",
      post({ title: "Limits", goal: "Understand limits" }),
    );
    const id = (thread.thread as Json).id;
    const resumed = await client.json(`/api/threads/${id}/resume`, post({}));
    expect((resumed.thread as Json).conversationId).toBe((resumed.conversation as Json).id);
  });
});
