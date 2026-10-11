import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createBackendHarness, post } from "./backend-harness.js";
import { providerFor, stageOutput } from "./tutor-test-fixtures.js";

const threadResult = z.object({ thread: z.object({ id: z.string() }).passthrough() });
const conversationResult = z.object({ conversation: z.object({ id: z.string() }) });

describe("thread-aware tutor API", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  it("persists planned targets and gaps without overwriting the project's desired outcome", async () => {
    const provider = providerFor((call) => {
      if (call.stage !== "planning") return stageOutput(call);
      const ids = z.array(z.string()).parse(call.data["knowledgeIds"]);
      return {
        ...z.record(z.string(), z.unknown()).parse(stageOutput(call)),
        targetUnits: ids.slice(0, 1),
        deferredUnits: ids.slice(1),
        deferredQuestions: ["Why is the machine finite?"],
        materialNeeds: z
          .array(z.object({ revisionId: z.string() }))
          .parse(call.data["knowledge"])
          .map((item) => ({
            knowledgeRevisionId: item.revisionId,
            blockTypes: ["definition"] as const,
          })),
      };
    });
    const { client } = harness.setup(provider);
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationResult.parse(
      await client.json("/api/conversations", post({})),
    );
    const { thread } = threadResult.parse(
      await client.json(
        "/api/threads",
        post({
          title: "Door controller",
          goal: "Model transitions",
          desiredOutcome: "Ship the controller",
          origin: "project",
          whyNow: "Fix an invalid state",
          conversationId: conversation.id,
        }),
      ),
    );
    const turn = threadResult.parse(
      await client.json(
        `/api/conversations/${conversation.id}/tutor-turn`,
        post({
          content: "Explain the FSM",
          threadId: thread.id,
        }),
      ),
    );
    expect(turn.thread.id).toBe(thread.id);
    const detail = z
      .object({
        thread: z.object({
          desiredOutcome: z.string(),
          origin: z.string(),
          targetKnowledgeUnitIds: z.array(z.string()),
          deferredKnowledgeUnitIds: z.array(z.string()),
        }),
        openQuestions: z.array(z.object({ id: z.string(), status: z.string() })),
      })
      .parse(await client.json(`/api/threads/${thread.id}`));
    expect(detail.thread.desiredOutcome).toBe("Ship the controller");
    expect(detail.thread.origin).toBe("project");
    expect(detail.thread.targetKnowledgeUnitIds).toHaveLength(1);
    expect(detail.thread.deferredKnowledgeUnitIds).toHaveLength(1);
    expect(detail.openQuestions).toHaveLength(1);
    const questionId = z.string().parse(detail.openQuestions[0]?.id);
    expect(
      (
        await client.call(`/api/threads/${thread.id}/questions/${questionId}`, {
          method: "PATCH",
          body: JSON.stringify({ status: "parked" }),
        })
      ).status,
    ).toBe(200);
    const resumed = conversationResult.parse(
      await client.json(`/api/threads/${thread.id}/resume`, post({})),
    );
    const continued = threadResult.parse(
      await client.json(
        `/api/conversations/${resumed.conversation.id}/tutor-turn`,
        post({ content: "Continue" }),
      ),
    );
    expect(continued.thread.id).toBe(thread.id);
  });

  it("keeps an established thread until the learner explicitly requests a new one", async () => {
    const { client } = harness.setup(providerFor());
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationResult.parse(
      await client.json("/api/conversations", post({})),
    );
    const first = threadResult.parse(
      await client.json(
        `/api/conversations/${conversation.id}/tutor-turn`,
        post({ content: "Explain FSM" }),
      ),
    );
    const second = threadResult.parse(
      await client.json(
        `/api/conversations/${conversation.id}/tutor-turn`,
        post({ content: "What about transitions?" }),
      ),
    );
    expect(second.thread.id).toBe(first.thread.id);
    const third = threadResult.parse(
      await client.json(
        `/api/conversations/${conversation.id}/tutor-turn`,
        post({
          content: "Start a new project",
          newThread: true,
          origin: "project",
          desiredOutcome: "Build a new controller",
        }),
      ),
    );
    expect(third.thread.id).not.toBe(first.thread.id);
    expect(third.thread["origin"]).toBe("project");
  }, 10_000);
});
