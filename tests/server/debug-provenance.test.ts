import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { KnowledgeDocumentRepository } from "../../src/server/knowledge-document-repository.js";
import type { StructuredCall } from "../../src/server/provider.js";
import { createBackendHarness, makeClient, post, scripted } from "./backend-harness.js";

const conversationSchema = z.object({ conversation: z.object({ id: z.string().uuid() }) });
const turnSchema = z.object({
  requestId: z.string().uuid(),
  tutorMessage: z.object({ id: z.string() }),
});
const settingsSchema = z.object({ saveProviderReasoningSummaries: z.boolean() });
const documentSchema = z.object({
  knowledgeId: z.string().uuid(),
  revisionId: z.string().uuid(),
  revision: z.number().int().positive(),
  title: z.string(),
  scope: z.enum(["canonical", "provisional"]),
  href: z.string(),
});
const provenanceSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  providedToModel: z.array(documentSchema),
  created: z.array(documentSchema),
  createdDocuments: z.array(
    z.object({
      documentId: z.string().uuid(),
      knowledgeId: z.string().uuid(),
      knowledgeRevisionId: z.string().uuid(),
      role: z.enum(["english_base", "localization"]),
      languageTag: z.string(),
    }),
  ),
  exposedInAnswer: z.array(documentSchema),
  exposureCoverage: z.literal("non_exhaustive"),
  reasoningSummaries: z.array(
    z.object({
      runId: z.string().uuid(),
      stage: z.string(),
      state: z.enum(["disabled", "available", "unavailable"]),
      text: z.string().optional(),
    }),
  ),
});

describe("answer debug provenance", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  it("keeps reasoning-summary settings private to each learner and off by default", async () => {
    // Given
    const { client, app } = harness.setup();
    const other = makeClient(app);
    await client.call("/api/auth/local-signup", post({}));
    await other.call("/api/auth/local-signup", post({}));

    // When
    const initial = settingsSchema.parse(await client.json("/api/settings/debug"));
    const updated = settingsSchema.parse(
      await client.json("/api/settings/debug", {
        method: "PUT",
        body: JSON.stringify({ saveProviderReasoningSummaries: true }),
      }),
    );
    const isolated = settingsSchema.parse(await other.json("/api/settings/debug"));

    // Then
    expect(initial.saveProviderReasoningSummaries).toBe(false);
    expect(updated.saveProviderReasoningSummaries).toBe(true);
    expect(isolated.saveProviderReasoningSummaries).toBe(false);
  });

  it("lists exact revisions provided, created, and exposed for one answer", async () => {
    // Given
    const { client, database } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationSchema.parse(
      await client.json("/api/conversations", post({})),
    );
    const turn = turnSchema.parse(
      await client.json(
        `/api/conversations/${conversation.id}/tutor-turn`,
        post({ content: "Explain this claim" }),
      ),
    );
    new KnowledgeDocumentRepository(database).migrateLegacy();

    // When
    const provenance = provenanceSchema.parse(
      await client.json(
        `/api/conversations/${conversation.id}/tutor-turns/${turn.requestId}/provenance`,
      ),
    );

    // Then
    expect(provenance.availability).toBe("available");
    expect(provenance.created).toHaveLength(1);
    expect(provenance.createdDocuments.length).toBeGreaterThan(0);
    expect(provenance.providedToModel).toContainEqual(
      expect.objectContaining({
        knowledgeId: provenance.created[0]?.knowledgeId,
        revisionId: provenance.created[0]?.revisionId,
        revision: 1,
      }),
    );
    expect(provenance.exposedInAnswer).toContainEqual(
      expect.objectContaining({ revisionId: provenance.created[0]?.revisionId }),
    );
    expect(provenance.created[0]?.href).toContain(
      `knowledge=${provenance.created[0]?.knowledgeId}&revision=1`,
    );
    const historical = await client.call(
      `/api/knowledge/${provenance.created[0]?.knowledgeId}/revisions/1`,
    );
    expect(historical.status).toBe(200);
  });

  it("persists public provider summaries only for runs whose start snapshot enabled them", async () => {
    // Given
    const base = scripted();
    const provider = {
      ...base,
      state: { ...base.state, provider: "openai" as const, outputMode: "responses" as const },
      call: async (call: StructuredCall) => ({
        ...z.object({ value: z.unknown(), usage: z.unknown() }).parse(await base.call(call)),
        reasoningSummary: {
          state: "available" as const,
          text: `Official ${call.stage} summary`,
        },
      }),
    };
    const { client } = harness.setup(provider);
    await client.call("/api/auth/local-signup", post({}));
    const { conversation } = conversationSchema.parse(
      await client.json("/api/conversations", post({})),
    );
    const offTurn = turnSchema.parse(
      await client.json(
        `/api/conversations/${conversation.id}/tutor-turn`,
        post({ content: "Summary remains off" }),
      ),
    );
    await client.call("/api/settings/debug", {
      method: "PUT",
      body: JSON.stringify({ saveProviderReasoningSummaries: true }),
    });
    const onTurn = turnSchema.parse(
      await client.json(
        `/api/conversations/${conversation.id}/tutor-turn`,
        post({ content: "Summary is now on" }),
      ),
    );

    // When
    const off = provenanceSchema.parse(
      await client.json(
        `/api/conversations/${conversation.id}/tutor-turns/${offTurn.requestId}/provenance`,
      ),
    );
    const on = provenanceSchema.parse(
      await client.json(
        `/api/conversations/${conversation.id}/tutor-turns/${onTurn.requestId}/provenance`,
      ),
    );

    // Then
    expect(off.reasoningSummaries.every((summary) => summary.state === "disabled")).toBe(true);
    expect(off.reasoningSummaries.every((summary) => summary.text === undefined)).toBe(true);
    expect(on.reasoningSummaries.some((summary) => summary.state === "available")).toBe(true);
    expect(on.reasoningSummaries.some((summary) => summary.text?.startsWith("Official"))).toBe(
      true,
    );
  });

  it("distinguishes an enabled unsupported run from a disabled run without retrying", async () => {
    // Given
    const base = scripted();
    let calls = 0;
    const provider = {
      ...base,
      state: { ...base.state, provider: "openai" as const, outputMode: "responses" as const },
      call: async (call: StructuredCall) => {
        calls += 1;
        return base.call(call);
      },
    };
    const { client } = harness.setup(provider);
    await client.call("/api/auth/local-signup", post({}));
    await client.call("/api/settings/debug", {
      method: "PUT",
      body: JSON.stringify({ saveProviderReasoningSummaries: true }),
    });
    const { conversation } = conversationSchema.parse(
      await client.json("/api/conversations", post({})),
    );

    // When
    const turn = turnSchema.parse(
      await client.json(
        `/api/conversations/${conversation.id}/tutor-turn`,
        post({ content: "Provider has no summary support" }),
      ),
    );
    const provenance = provenanceSchema.parse(
      await client.json(
        `/api/conversations/${conversation.id}/tutor-turns/${turn.requestId}/provenance`,
      ),
    );

    // Then
    expect(provenance.reasoningSummaries.every((summary) => summary.state === "unavailable")).toBe(
      true,
    );
    expect(calls).toBe(provenance.reasoningSummaries.length);
  });
});
