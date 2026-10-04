import { once } from "node:events";
import { Server } from "node:http";
import { serve } from "@hono/node-server";
import ky from "ky";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createWorkspaceApi } from "../../src/client/api";
import { createApp } from "../../src/server/app";
import { createProvider } from "../../src/server/provider";

describe("learning workspace API integration", () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    for (const cleanup of cleanups.splice(0)) await cleanup();
  });

  async function setup() {
    const demo = createProvider({ TUTOR_PROVIDER: "demo", TUTOR_EMBEDDING_PROVIDER: "disabled" });
    const controls = { failEvaluation: false, loseResponseOnce: false };
    const runtime = createApp({
      databasePath: ":memory:",
      provider: {
        state: demo.state,
        embeddingProfile: demo.embeddingProfile,
        async call(call) {
          if (controls.failEvaluation && call.stage === "evaluation")
            throw new Error("Evaluation offline");
          return demo.call(call);
        },
      },
    });
    const server = serve({ fetch: runtime.app.fetch, port: 0, hostname: "127.0.0.1" });
    await once(server, "listening");
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("Missing test port");
    cleanups.push(async () => {
      if (server instanceof Server) server.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
      runtime.database.close();
    });
    let cookie = "";
    const client = ky.create({
      prefixUrl: `http://127.0.0.1:${address.port}/api`,
      retry: 0,
      hooks: {
        beforeRequest: [
          (request) => {
            request.headers.set("cookie", cookie);
          },
        ],
        afterResponse: [
          (request, _options, response) => {
            cookie = response.headers.get("set-cookie")?.split(";")[0] ?? cookie;
            if (controls.loseResponseOnce && request.url.endsWith("/tutor-turn") && response.ok) {
              controls.loseResponseOnce = false;
              throw new Error("Response connection lost");
            }
            return response;
          },
        ],
      },
    });
    return { api: createWorkspaceApi(client), client, controls };
  }

  it("keeps conversation identity separate and explicitly resumes linked parked threads", async () => {
    const { api } = await setup();
    const created = await api.createLearningThread({
      title: "FSM project",
      desiredOutcome: "Ship a controller",
      origin: "project",
      whyNow: "Prevent invalid states",
    });
    const id = z.string().parse(created.activeLearningThread?.id);
    expect(created.activeConversationId).not.toBe(id);
    expect(created.learningThreads.map((thread) => thread.id)).toContain(id);
    expect(created.conversations.map((conversation) => conversation.id)).not.toContain(id);
    await api.setThreadStatus(id, "paused");
    const resumed = await api.openSearchThread(id);
    expect(resumed.activeConversationId).toBe(created.activeConversationId);
    expect(resumed.activeLearningThread).toMatchObject({
      id,
      status: "open",
      desiredOutcome: "Ship a controller",
    });
  });

  it("resolves a saved ambiguous question without a duplicate learner message", async () => {
    const { api, client } = await setup();
    const first = await api.createLearningThread({
      title: "FSM",
      desiredOutcome: "Learn controllers",
      origin: "project",
      whyNow: "",
    });
    const id = z.string().parse(first.activeLearningThread?.id);
    await api.createLearningThread({
      title: "FSM",
      desiredOutcome: "Learn another model",
      origin: "question",
      whyNow: "",
    });
    const conversation = await api.createConversation();
    await expect(api.sendMessage(conversation.activeConversationId, "FSM")).rejects.toThrow();
    const failed = await api.load();
    expect(failed.recovery).toMatchObject({ kind: "selection", content: "FSM" });
    expect(failed.messages.filter((message) => message.role === "user")).toHaveLength(1);
    const resolved = await api.resolveTurn({ threadId: id });
    expect(resolved.recovery).toBeNull();
    expect(resolved.activeLearningThread?.id).toBe(id);
    expect(resolved.messages.filter((message) => message.role === "user")).toHaveLength(1);
    const source = z
      .object({ messages: z.array(z.object({ role: z.string() })) })
      .parse(await client.get(`conversations/${conversation.activeConversationId}`).json());
    expect(source.messages.filter((message) => message.role === "user")).toHaveLength(1);
  });

  it("retains response-scoped tracking warnings after a refresh", async () => {
    const { api, controls } = await setup();
    const created = await api.createLearningThread({
      title: "FSM",
      desiredOutcome: "Learn",
      origin: "question",
      whyNow: "",
    });
    controls.failEvaluation = true;
    const sent = await api.sendMessage(created.activeConversationId, "Explain FSM");
    expect(
      sent.messages.find((message) => message.role === "assistant")?.tracking?.evaluationSkipped,
    ).toBe(true);
    expect(
      (await api.load()).messages.find((message) => message.role === "assistant")?.tracking
        ?.evaluationSkipped,
    ).toBe(true);
  });

  it("recovers a completed request after a lost response without rerunning tutoring", async () => {
    const { api, client, controls } = await setup();
    const created = await api.createLearningThread({
      title: "FSM",
      desiredOutcome: "Learn",
      origin: "question",
      whyNow: "",
    });
    controls.loseResponseOnce = true;
    const recovered = await api.sendMessage(created.activeConversationId, "Explain FSM");
    expect(recovered.recovery).toBeNull();
    const before = z
      .object({ modelRuns: z.array(z.unknown()) })
      .parse(await client.get("export").json());
    const retried = await api.load();
    expect(retried.messages.filter((message) => message.role === "user")).toHaveLength(1);
    expect(retried.messages.filter((message) => message.role === "assistant")).toHaveLength(1);
    const after = z
      .object({ modelRuns: z.array(z.unknown()) })
      .parse(await client.get("export").json());
    expect(after.modelRuns).toHaveLength(before.modelRuns.length);
    expect(retried.recovery).toBeNull();
  });
});
