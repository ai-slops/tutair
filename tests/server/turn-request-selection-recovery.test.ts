import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createBackendHarness, type Json, post } from "./backend-harness.js";

const requestId = "22222222-2222-4222-8222-222222222222";

describe("tutor turn selection recovery", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  it("keeps a closed explicit thread recoverable without replacing the learner source", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const threadId = z
      .object({ thread: z.object({ id: z.string() }) })
      .parse(await client.json("/api/threads", post({ title: "Closed", goal: "Closed goal" })))
      .thread.id;
    await client.call(`/api/threads/${threadId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "paused" }),
    });
    const conversationId = z
      .object({ conversation: z.object({ id: z.string() }) })
      .parse(await client.json("/api/conversations", post({}))).conversation.id;
    const input = { requestId, content: "Continue safely", threadId };

    // When
    const closed = await client.call(
      `/api/conversations/${conversationId}/tutor-turn`,
      post(input),
    );

    // Then
    expect(closed.status).toBe(409);
    const error = (await closed.json()) as Json;
    expect(error.error).toEqual(
      expect.objectContaining({
        code: "thread_not_open",
        details: expect.objectContaining({ candidateIds: JSON.stringify([threadId]) }),
      }),
    );
    const detail = await client.json(`/api/conversations/${conversationId}`);
    expect(detail["turnOutcomes"]).toEqual([
      expect.objectContaining({ state: "needs_selection", content: "Continue safely" }),
    ]);
    const recovered = await client.call(
      `/api/conversations/${conversationId}/tutor-turn`,
      post({ requestId, content: "Continue safely", newThread: true }),
    );
    expect(recovered.status).toBe(201);
    expect((await client.json(`/api/conversations/${conversationId}`)).messages).toHaveLength(2);
  });
});
