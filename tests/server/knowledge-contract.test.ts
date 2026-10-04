import { describe, expect, it } from "vitest";
import {
  canonicalKnowledgeYamlSchema,
  evidenceEvaluatorSchema,
  knowledgeCreateBoundarySchema,
  migrateRevisionMetadata,
  normalizeRevisionClaims,
  relationNecessitySchema,
} from "../../src/server/knowledge-contracts.js";
import { canonicalPost, createBackendHarness, type Json, post } from "./backend-harness.js";

describe("knowledge metadata contracts", () => {
  const harness = createBackendHarness();

  it("preserves structured definition scope and reviewed claim provenance", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const definitionScope = {
      domain: "programming languages",
      context: "compile-time type checking",
      audienceLevel: "introductory",
      inclusions: ["static checking"],
      exclusions: ["runtime validation"],
    };
    const claim = {
      text: "The checker runs before execution",
      authority: "external",
      sourceRefs: ["book:types#2"],
      status: "reviewed",
    };

    // When
    const created = await client.json(
      "/api/knowledge",
      post({
        title: "Static typing",
        statement: "Types are checked before execution",
        semanticScope: "programming language type systems",
        definitionScope,
        claims: [claim, "legacy plain claim"],
      }),
    );
    const knowledgeId = (created.item as Json).id;
    const detail = await client.json(`/api/knowledge/${knowledgeId}`);

    // Then
    expect((detail.revisions as Json[])[0]).toMatchObject({
      semanticScope: "programming language type systems",
      definitionScope,
      claims: [claim, "legacy plain claim"],
    });
    harness.cleanup();
  });

  it("defaults model claims without allowing self-promotion", () => {
    // Given
    const generated = { text: "Generated", authority: "provisional", sourceRefs: [] } as const;

    // When
    const normalized = normalizeRevisionClaims([generated], "model_generated");

    // Then
    expect(normalized).toEqual([{ ...generated, status: "model_generated" }]);
    expect(() =>
      normalizeRevisionClaims([{ ...generated, status: "source_supported" }], "model_generated"),
    ).toThrow("Model-generated claims cannot self-promote");
  });

  it("does not invent status for legacy manual structured claims", () => {
    // Given
    const legacy = { text: "Legacy", authority: "external", sourceRefs: ["book:v1"] } as const;

    // When / Then
    expect(normalizeRevisionClaims([legacy], "learner_manual")).toEqual([legacy]);
  });

  it("accepts legacy and original relation necessity without remapping numbers", () => {
    // Given / When / Then
    for (const value of [
      "hard",
      "soft",
      "contextual",
      "recommended",
      "required",
      "helpful",
      "optional",
      0.73,
    ]) {
      expect(relationNecessitySchema.parse(value)).toBe(value);
    }
  });

  it("accepts test runner evaluator metadata as data only", () => {
    // Given
    const metadata = {
      type: "test_runner",
      rubricVersion: "tests-v2",
      runner: "vitest",
      suiteRef: "knowledge-contract",
    };

    // When / Then
    expect(evidenceEvaluatorSchema.parse(metadata)).toEqual(metadata);
  });

  it("migrates missing revision metadata while preserving legacy claim formats", () => {
    // Given
    const legacy = {
      semantic_scope: "legacy scope",
      claims_json: JSON.stringify([
        "plain claim",
        { text: "sourced", authority: "external", sourceRefs: ["ref"] },
      ]),
    };

    // When
    const migrated = migrateRevisionMetadata(legacy);

    // Then
    expect(migrated).toEqual({
      semanticScope: "legacy scope",
      definitionScope: {},
      claims: ["plain claim", { text: "sourced", authority: "external", sourceRefs: ["ref"] }],
    });
  });

  it("initializes every dimension as unknown for a meaning mismatch unit", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const original = await client.json(
      "/api/knowledge",
      post({ title: "Formal", statement: "Ceremonial" }),
    );

    // When
    const corrected = await client.json(
      "/api/corrections",
      post({
        knowledgeId: (original.item as Json).id,
        revision: 1,
        statement: "Specified by a formal system",
        reason: "different meaning",
        kind: "meaning_mismatch",
      }),
    );
    const detail = await client.json(`/api/knowledge/${(corrected.item as Json).id}`);

    // Then
    expect(detail.learnerState).toHaveLength(6);
    expect((detail.learnerState as Json[]).every((state) => state.status === "unknown")).toBe(true);
    harness.cleanup();
  });

  it("keeps public input and canonical YAML schemas aligned", () => {
    // Given
    const item = knowledgeCreateBoundarySchema.parse({
      title: "Term",
      statement: "Definition",
      definitionScope: { domain: "logic" },
      claims: ["legacy"],
    });

    // When
    const { scope: _scope, ...canonicalItem } = item;
    const canonical = canonicalKnowledgeYamlSchema.parse({
      source: "manual:v1",
      items: [{ key: "term", ...canonicalItem, relations: [] }],
    });

    // Then
    expect(canonical.items[0]?.definitionScope).toEqual({ domain: "logic" });
  });

  it("rejects canonical reimport when structured definition scope changes", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const first = await client.json(
      "/api/knowledge/import",
      canonicalPost({
        format: "yaml",
        content:
          "source: glossary-v1\nitems:\n  - key: formal\n    title: Formal\n    statement: Defined by rules\n    semanticScope: technical usage\n    definitionScope:\n      domain: mathematics\n",
      }),
    );
    const id = (((first.imported as Json[])[0] as Json).item as Json).id;

    // When
    const response = await client.call(
      "/api/knowledge/import",
      canonicalPost({
        format: "yaml",
        content:
          "source: glossary-v2\nitems:\n  - key: formal\n    title: Formal\n    statement: Defined by rules\n    semanticScope: technical usage\n    definitionScope:\n      domain: social customs\n",
      }),
    );

    // Then
    expect(response.status).toBe(409);
    expect((await client.json(`/api/knowledge/${id}`)).revisions).toHaveLength(1);
    harness.cleanup();
  });

  it("reimports normalized equivalent structured scope regardless of list order", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const first = await client.json(
      "/api/knowledge/import",
      canonicalPost({
        format: "yaml",
        content:
          "source: glossary-v1\nitems:\n  - key: typed\n    title: Typed\n    statement: Has a type\n    semanticScope: Type Systems\n    definitionScope:\n      domain: Programming Languages\n      inclusions: [static checking, compile time]\n",
      }),
    );
    const id = (((first.imported as Json[])[0] as Json).item as Json).id;

    // When
    const response = await client.call(
      "/api/knowledge/import",
      canonicalPost({
        format: "yaml",
        content:
          "source: glossary-v2\nitems:\n  - key: typed\n    title: Typed\n    statement: Has an assigned type\n    semanticScope: type systems\n    definitionScope:\n      domain: programming languages\n      inclusions: [COMPILE TIME, STATIC CHECKING]\n",
      }),
    );

    // Then
    expect(response.status).toBe(201);
    expect((await client.json(`/api/knowledge/${id}`)).revisions).toHaveLength(2);
    harness.cleanup();
  });

  it("preserves revision metadata and source conversation when correcting a statement", async () => {
    // Given
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({}));
    const conversation = await client.json("/api/conversations", post({ title: "Correction" }));
    const conversationId = (conversation.conversation as Json).id;
    const message = await client.json(
      `/api/conversations/${conversationId}/messages`,
      post({ content: "The corrected definition is narrower" }),
    );
    const messageId = (message.message as Json).id;
    const claim = {
      text: "Applies to compile-time checking",
      authority: "external",
      sourceRefs: ["book:types#3"],
      status: "reviewed",
    };
    const created = await client.json(
      "/api/knowledge",
      post({
        title: "Static typing",
        statement: "Initial wording",
        semanticScope: "type systems",
        definitionScope: {
          domain: "programming languages",
          inclusions: ["compile-time checks"],
        },
        distinguishingFeatures: ["checked before execution"],
        claims: [claim],
      }),
    );
    const knowledgeId = (created.item as Json).id;

    // When
    await client.call(
      "/api/corrections",
      post({
        knowledgeId,
        revision: 1,
        statement: "Corrected wording",
        reason: "precision",
        messageId,
        kind: "revise",
      }),
    );
    const revisions = (await client.json(`/api/knowledge/${knowledgeId}`)).revisions as Json[];

    // Then
    expect(revisions[1]).toMatchObject({
      statement: "Corrected wording",
      semanticScope: "type systems",
      definitionScope: {
        domain: "programming languages",
        inclusions: ["compile-time checks"],
      },
      distinguishingFeatures: ["checked before execution"],
      claims: [claim],
      sourceRefs: [],
      conversationId,
      sourceMessageIds: [messageId],
    });
    expect(revisions[1]?.["sourceMessageEventIds"]).toHaveLength(1);
    harness.cleanup();
  });
});
