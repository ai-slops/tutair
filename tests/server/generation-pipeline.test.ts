import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { StructuredCall } from "../../src/server/provider.js";
import { createBackendHarness, makeClient, post, scripted } from "./backend-harness.js";

const requestA = "11111111-1111-4111-8111-111111111111";
const requestB = "22222222-2222-4222-8222-222222222222";
const conversationResponse = z.object({ conversation: z.object({ id: z.string() }) });
const stageSchema = z.object({
  runId: z.string(),
  stage: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  attempt: z.number().int().positive(),
  repairOfRunId: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  model: z.string().nullable(),
  usage: z
    .object({ inputTokens: z.number(), outputTokens: z.number(), totalTokens: z.number() })
    .nullable(),
});
const pipelineSchema = z.object({
  requestId: z.string(),
  state: z.enum(["running", "needs_selection", "completed", "failed"]),
  userMessageId: z.string(),
  stages: z.array(stageSchema),
});

describe("generation pipeline inspection", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  it("reports the actual running stage while the tutor POST is pending", async () => {
    // Given
    const base = scripted();
    let entered = (): void => undefined;
    let release = (): void => undefined;
    const stageEntered = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    let calls = 0;
    const provider = {
      ...base,
      call: async (call: StructuredCall) => {
        calls += 1;
        if (calls === 1) {
          entered();
          await blocked;
        }
        return base.call(call);
      },
    };
    const { client } = harness.setup(provider);
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationResponse.parse(
      await client.json("/api/conversations", post({})),
    );
    const pending = client.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post({ requestId: requestA, content: "Show the live stage" }),
    );
    await stageEntered;

    // When
    const pipeline = pipelineSchema.parse(
      await client.json(`/api/conversations/${conversation.id}/tutor-turns/${requestA}/pipeline`),
    );

    // Then
    expect(pipeline.state).toBe("running");
    expect(pipeline.stages).toEqual([
      expect.objectContaining({ stage: "evaluation", status: "running", finishedAt: null }),
    ]);
    release();
    expect((await pending).status).toBe(201);
  });

  it("isolates requests and orders a failed attempt before its repair", async () => {
    // Given
    const base = scripted();
    let invalidated = false;
    const provider = {
      ...base,
      call: async (call: StructuredCall) => {
        if (call.stage === "extraction" && !invalidated) {
          invalidated = true;
          return {
            value: { invalid: true },
            usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
            resolvedModel: "account-model-at-run-time",
          };
        }
        const response = z
          .object({ value: z.unknown(), usage: z.unknown() })
          .parse(await base.call(call));
        return { ...response, resolvedModel: "account-model-at-run-time" };
      },
    };
    const { client } = harness.setup(provider);
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationResponse.parse(
      await client.json("/api/conversations", post({})),
    );
    await client.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post({ requestId: requestA, content: "Repair this stage" }),
    );
    await client.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post({ requestId: requestB, content: "A different turn" }),
    );

    // When
    const pipeline = pipelineSchema.parse(
      await client.json(`/api/conversations/${conversation.id}/tutor-turns/${requestA}/pipeline`),
    );
    const extraction = pipeline.stages.filter((stage) => stage.stage === "extraction");

    // Then
    expect(pipeline.requestId).toBe(requestA);
    expect(extraction).toHaveLength(2);
    expect(extraction[0]).toMatchObject({ status: "failed", attempt: 1, repairOfRunId: null });
    expect(extraction[0]).toMatchObject({
      model: "account-model-at-run-time",
      usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5 },
    });
    expect(extraction[1]).toMatchObject({ status: "completed", attempt: 2 });
    expect(extraction[1]?.repairOfRunId).toBe(extraction[0]?.runId);
    expect(pipeline.stages.every((stage) => stage.finishedAt !== null)).toBe(true);
  });

  it("returns 404 for a foreign owner and for the wrong conversation", async () => {
    // Given
    const { client, app } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationResponse.parse(
      await client.json("/api/conversations", post({})),
    );
    const { conversation: otherConversation } = conversationResponse.parse(
      await client.json("/api/conversations", post({})),
    );
    await client.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post({ requestId: requestA, content: "Private trace" }),
    );
    const otherOwner = makeClient(app);
    await otherOwner.call("/api/auth/local-signup", post({}));

    // When
    const foreign = await otherOwner.call(
      `/api/conversations/${conversation.id}/tutor-turns/${requestA}/pipeline`,
    );
    const wrongConversation = await client.call(
      `/api/conversations/${otherConversation.id}/tutor-turns/${requestA}/pipeline`,
    );

    // Then
    expect(foreign.status).toBe(404);
    expect(wrongConversation.status).toBe(404);
  });

  it("lazily returns a redacted recorded call, output, and traces for one owned run", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationResponse.parse(
      await client.json("/api/conversations", post({})),
    );
    await client.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post({ requestId: requestA, content: "Bearer secret-value must not leak" }),
    );
    const pipeline = pipelineSchema.parse(
      await client.json(`/api/conversations/${conversation.id}/tutor-turns/${requestA}/pipeline`),
    );
    const runId = pipeline.stages[0]?.runId;
    expect(runId).toBeDefined();

    // When
    const response = await client.call(
      `/api/conversations/${conversation.id}/tutor-turns/${requestA}/pipeline/${runId}`,
    );
    const detail: unknown = await response.json();

    // Then
    expect(response.status).toBe(200);
    const serialized = JSON.stringify(detail);
    expect(serialized).not.toContain("secret-value");
    expect(serialized).toContain("[redacted]");
    expect(detail).toEqual(
      expect.objectContaining({
        runId,
        recordedCall: expect.objectContaining({ available: true }),
        traces: expect.any(Array),
      }),
    );
  });

  it("keeps inspection available when historical diagnostic JSON is malformed", async () => {
    // Given
    const { client, database } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationResponse.parse(
      await client.json("/api/conversations", post({})),
    );
    await client.call(
      `/api/conversations/${conversation.id}/tutor-turn`,
      post({ requestId: requestA, content: "Inspect damaged historical diagnostics" }),
    );
    const initial = pipelineSchema.parse(
      await client.json(`/api/conversations/${conversation.id}/tutor-turns/${requestA}/pipeline`),
    );
    const runId = initial.stages[0]?.runId;
    expect(runId).toBeDefined();
    if (runId === undefined) throw new Error("Expected a recorded model run");
    database.run("UPDATE tutor_turn_requests SET run_json=? WHERE request_id=?", ["{", requestA]);
    database.run("UPDATE model_run_details SET usage_json=?,output_json=? WHERE run_id=?", [
      "{",
      "{",
      runId,
    ]);
    database.raw.exec("DROP TRIGGER immutable_model_run_contexts_update");
    database.run("UPDATE model_run_contexts SET context_json=? WHERE run_id=?", ["{", runId]);
    database.run("UPDATE traces SET data_json=? WHERE run_id=?", ["{", runId]);

    // When
    const summaryResponse = await client.call(
      `/api/conversations/${conversation.id}/tutor-turns/${requestA}/pipeline`,
    );
    const detailResponse = await client.call(
      `/api/conversations/${conversation.id}/tutor-turns/${requestA}/pipeline/${runId}`,
    );
    const summary: unknown = await summaryResponse.json();
    const detail: unknown = await detailResponse.json();

    // Then
    expect(summaryResponse.status).toBe(200);
    expect(summary).toEqual(
      expect.objectContaining({
        flags: null,
        stages: expect.arrayContaining([expect.objectContaining({ runId, usage: null })]),
      }),
    );
    expect(detailResponse.status).toBe(200);
    expect(detail).toEqual(
      expect.objectContaining({
        recordedCall: expect.objectContaining({ available: false }),
        response: expect.objectContaining({ available: false }),
        traces: expect.arrayContaining([expect.objectContaining({ data: null })]),
      }),
    );
  });
});
