import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackendHarness, type Json, post, scripted } from "./backend-harness.js";

describe("Phase 1 mutation boundaries", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  it("blocks deletion when a conversation has preserved message history", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const created = await client.json("/api/conversations", post({}));
    const conversationId = (created.conversation as Json).id;
    await client.call(
      `/api/conversations/${conversationId}/messages`,
      post({ content: "preserve this" }),
    );

    // When
    const response = await client.call(`/api/conversations/${conversationId}`, {
      method: "DELETE",
    });

    // Then
    expect(response.status).toBe(409);
    expect((await client.json(`/api/conversations/${conversationId}`)).messages).toHaveLength(1);
  });

  it("rejects a concurrent turn before persisting a second learner message", async () => {
    // Given
    const base = scripted();
    let markEntered = (): void => undefined;
    let releaseFirst = (): void => undefined;
    const entered = new Promise<void>((resolve) => {
      markEntered = resolve;
    });
    const release = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    let calls = 0;
    const provider = {
      ...base,
      call: async (...input: Parameters<typeof base.call>) => {
        calls += 1;
        if (calls === 1) {
          markEntered();
          await release;
        }
        return base.call(...input);
      },
    };
    const { client } = harness.setup(provider);
    await client.call("/api/auth/local-signup", post({}));
    const created = await client.json("/api/conversations", post({}));
    const conversationId = (created.conversation as Json).id;

    // When
    const first = client.call(
      `/api/conversations/${conversationId}/tutor-turn`,
      post({ content: "first turn" }),
    );
    await entered;
    const second = await client.call(
      `/api/conversations/${conversationId}/tutor-turn`,
      post({ content: "second turn" }),
    );
    releaseFirst();
    const completed = await first;

    // Then
    expect(completed.status).toBe(201);
    expect(second.status).toBe(409);
    const messages = (await client.json(`/api/conversations/${conversationId}`)).messages as Json[];
    expect(messages.filter((message) => message["role"] === "user")).toHaveLength(1);
  });
});
