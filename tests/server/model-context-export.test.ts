import { afterEach, beforeEach, expect, it } from "vitest";
import { z } from "zod";
import { migrateThreads } from "../../src/server/thread-migration.js";
import { createBackendHarness, makeClient, post } from "./backend-harness.js";

const harness = createBackendHarness();
beforeEach(harness.reset);
afterEach(harness.cleanup);

it("exports only the signed-in learner's private model contexts and erases them on privacy deletion", async () => {
  // Given
  const { app, client, database } = harness.setup();
  migrateThreads(database.raw);
  await client.call("/api/auth/local-signup", post({ displayName: "First" }));
  const firstConversation = await client.json("/api/conversations", post({}));
  const firstId = z.object({ id: z.string() }).parse(firstConversation.conversation).id;
  await client.call(
    `/api/conversations/${firstId}/tutor-turn`,
    post({ content: "First question" }),
  );
  const other = makeClient(app);
  await other.call("/api/auth/local-signup", post({ displayName: "Second" }));
  const secondConversation = await other.json("/api/conversations", post({}));
  const secondId = z.object({ id: z.string() }).parse(secondConversation.conversation).id;
  await other.call(
    `/api/conversations/${secondId}/tutor-turn`,
    post({ content: "Second question" }),
  );

  // When
  const exported = await client.json("/api/export");

  // Then
  const contexts = z.array(z.object({ runId: z.string() })).parse(exported["modelRunContexts"]);
  expect(contexts.length).toBeGreaterThan(0);
  const ownedRuns = new Set(
    z
      .array(z.object({ id: z.string() }))
      .parse(exported["modelRuns"])
      .map((run) => run.id),
  );
  expect(contexts.every((context) => ownedRuns.has(context.runId))).toBe(true);
  const ownedThreads = new Set(
    z
      .array(z.object({ id: z.string() }))
      .parse(exported["threads"])
      .map((thread) => thread.id),
  );
  const currentThreads = z
    .array(z.object({ threadId: z.string() }))
    .parse(exported["currentThreads"]);
  expect(currentThreads.length).toBeGreaterThan(0);
  expect(currentThreads.every((current) => ownedThreads.has(current.threadId))).toBe(true);
  const ownedQuestions = new Set(
    z
      .array(z.object({ id: z.string() }))
      .parse(exported["openQuestions"])
      .map((question) => question.id),
  );
  const questionEvents = z
    .array(z.object({ questionId: z.string() }))
    .parse(exported["threadQuestionEvents"]);
  expect(questionEvents.length).toBeGreaterThan(0);
  expect(questionEvents.every((event) => ownedQuestions.has(event.questionId))).toBe(true);
  const otherContexts = z
    .array(z.unknown())
    .parse((await other.json("/api/export"))["modelRunContexts"]);
  await client.call("/api/privacy", { method: "DELETE" });
  expect(database.raw.prepare("SELECT COUNT(*) AS count FROM model_run_contexts").get()).toEqual({
    count: otherContexts.length,
  });
});
