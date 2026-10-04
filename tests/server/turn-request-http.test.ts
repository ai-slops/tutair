import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { StructuredCall } from "../../src/server/provider.js";
import { createBackendHarness, type Json, makeClient, post, scripted } from "./backend-harness.js";

const requestId = "11111111-1111-4111-8111-111111111111";
const conversationResult = z.object({ conversation: z.object({ id: z.string() }) });

describe("tutor turn request idempotency", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  it("replays a completed request without another saved message or provider call", async () => {
    // Given
    const base = scripted();
    let calls = 0;
    const provider = {
      ...base,
      call: async (input: StructuredCall) => {
        calls += 1;
        return base.call(input);
      },
    };
    const { client } = harness.setup(provider);
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationResult.parse(
      await client.json("/api/conversations", post({})),
    );
    const input = { requestId, content: "Explain idempotency" };
    const first = await client.json(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post(input),
    );
    const callsAfterFirst = calls;

    // When
    const replay = await client.json(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post(input),
    );

    // Then
    expect(replay).toEqual(first);
    expect(calls).toBe(callsAfterFirst);
    const detail = await client.json(`/api/conversations/${conversation.id}`);
    expect(detail.messages).toHaveLength(2);
    expect(detail["turnOutcomes"]).toEqual([
      expect.objectContaining({
        requestId,
        tutorMessageId: (first.tutorMessage as Json).id,
        state: "completed",
        content: "Explain idempotency",
      }),
    ]);
  });

  it("returns the saved source while the same request is running", async () => {
    // Given
    const base = scripted();
    let enter = (): void => undefined;
    let release = (): void => undefined;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const provider = {
      ...base,
      call: async (input: StructuredCall) => {
        calls += 1;
        if (calls === 1) {
          enter();
          await blocked;
        }
        return base.call(input);
      },
    };
    const { client } = harness.setup(provider);
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationResult.parse(
      await client.json("/api/conversations", post({})),
    );
    const input = { requestId, content: "Wait safely" };
    const first = client.call(`/api/conversations/${conversation.id}/tutor-turn`, post(input));
    await entered;

    // When
    const replay = await client.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post(input),
    );

    // Then
    expect(replay.status).toBe(409);
    const error = (await replay.json()) as Json;
    expect(error.error).toEqual(
      expect.objectContaining({
        code: "turn_request_in_progress",
        details: expect.objectContaining({ requestId, userMessageId: expect.any(String) }),
      }),
    );
    expect(calls).toBe(1);
    const detail = await client.json(`/api/conversations/${conversation.id}`);
    expect(detail["turnOutcomes"]).toEqual([
      expect.objectContaining({ requestId, state: "running", content: "Wait safely" }),
    ]);
    release();
    expect((await first).status).toBe(201);
  });

  it("resolves an ambiguous request with an explicit selection and reuses its source", async () => {
    // Given
    const base = scripted();
    let modelCalls = 0;
    const provider = {
      ...base,
      call: async (input: StructuredCall) => {
        modelCalls += 1;
        return base.call(input);
      },
    };
    const { client } = harness.setup(provider);
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationResult.parse(
      await client.json("/api/conversations", post({})),
    );
    const firstThread = z
      .object({ thread: z.object({ id: z.string() }) })
      .parse(
        await client.json("/api/threads", post({ title: "State alpha", goal: "Alpha" })),
      ).thread;
    await client.call("/api/threads", post({ title: "State beta", goal: "Beta" }));
    const initial = { requestId, content: "state" };
    const ambiguous = await client.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post(initial),
    );
    expect(ambiguous.status).toBe(409);
    expect(modelCalls).toBe(0);
    expect((await client.json(`/api/conversations/${conversation.id}`))["turnOutcomes"]).toEqual([
      expect.objectContaining({
        requestId,
        state: "needs_selection",
        error: expect.objectContaining({ code: "thread_selection_ambiguous" }),
      }),
    ]);

    // When
    const selected = await client.json(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post({ ...initial, threadId: firstThread.id }),
    );

    // Then
    expect((selected.thread as Json).id).toBe(firstThread.id);
    const detail = await client.json(`/api/conversations/${conversation.id}`);
    const messages = detail.messages as Json[];
    expect(messages.filter((message) => message["role"] === "user")).toHaveLength(1);
    expect(messages.filter((message) => message["role"] === "tutor")).toHaveLength(1);
  });

  it("rejects changed base input for an existing request id", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationResult.parse(
      await client.json("/api/conversations", post({})),
    );
    await client.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post({ requestId, content: "Original" }),
    );

    // When
    const conflict = await client.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post({ requestId, content: "Changed" }),
    );

    // Then
    expect(conflict.status).toBe(409);
    expect(((await conflict.json()) as Json).error).toEqual(
      expect.objectContaining({ code: "turn_request_conflict" }),
    );
    const detail = await client.json(`/api/conversations/${conversation.id}`);
    expect(detail.messages).toHaveLength(2);
  });

  it("replays a cached non-selection failure without executing the provider again", async () => {
    // Given
    const base = scripted();
    let calls = 0;
    const provider = {
      ...base,
      call: async (): Promise<never> => {
        calls += 1;
        throw new Error("offline");
      },
    };
    const { client } = harness.setup(provider);
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationResult.parse(
      await client.json("/api/conversations", post({})),
    );
    const input = { requestId, content: "Fail once" };
    const first = await client.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post(input),
    );
    expect(first.status).toBe(500);
    const callsAfterFirst = calls;

    // When
    const replay = await client.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post(input),
    );

    // Then
    expect(replay.status).toBe(500);
    expect(await replay.json()).toEqual(await first.json());
    expect(calls).toBe(callsAfterFirst);
    const detail = await client.json(`/api/conversations/${conversation.id}`);
    expect(detail.messages).toHaveLength(1);
  });

  it("owner-scopes request lookup and erases requests with the learner", async () => {
    // Given
    const { client, app, database } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationResult.parse(
      await client.json("/api/conversations", post({})),
    );
    await client.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post({ requestId, content: "Private retry" }),
    );
    const other = makeClient(app);
    await other.call("/api/auth/local-signup", post({}));

    // When
    const crossOwner = await other.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post({ requestId, content: "Private retry" }),
    );
    const erased = await client.call("/api/privacy", { method: "DELETE" });

    // Then
    expect(crossOwner.status).toBe(404);
    expect(erased.status).toBe(204);
    const count = z
      .object({ count: z.number() })
      .parse(database.raw.prepare("SELECT COUNT(*) AS count FROM tutor_turn_requests").get());
    expect(count.count).toBe(0);
  });
});
