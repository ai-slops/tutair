import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { normalizeResolution } from "../../src/server/resolution-policy.js";
import type { KnowledgeContext } from "../../src/server/tutor-knowledge.js";
import type { candidateSchema, resolutionSchema } from "../../src/server/tutor-schemas.js";

const candidate = {
  key: "formal",
  label: "formal",
  definition: "Explicit components and rules",
  semanticScope: "computer science",
  kind: "term_sense",
  aliases: [],
  distinguishingFeatures: ["explicit rules"],
  claims: [],
  riskScope: "stable",
  confidence: 0.9,
  sourceSpans: [],
} satisfies z.infer<typeof candidateSchema>;
const offered: KnowledgeContext = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "formal",
  scope: "canonical",
  revision: 1,
  revisionId: "22222222-2222-4222-8222-222222222222",
  definition: candidate.definition,
  semanticScope: candidate.semanticScope,
  distinguishingFeatures: [],
  claims: [],
  riskScope: "stable",
  kind: "term_sense",
  aliases: [],
};
const match = {
  candidateKey: "formal",
  knowledgeId: offered.id,
  revision: 1,
  confidence: 0.99,
  decision: "semantic",
  reasonCodes: ["same_scope", "same_definition"],
} satisfies z.infer<typeof resolutionSchema>["matches"][number];

describe("conservative knowledge resolution", () => {
  it("reuses an offered compatible revision with strong equivalence confidence", () => {
    const result = normalizeResolution({
      candidates: [candidate],
      offeredKnowledge: [offered],
      resolution: { matches: [match], provisional: [] },
    });
    expect(result.decisions[0]?.resolution).toBe("reuse");
  });

  it("duplicates an uncertain match instead of silently merging", () => {
    const result = normalizeResolution({
      candidates: [candidate],
      offeredKnowledge: [offered],
      resolution: { matches: [{ ...match, confidence: 0.05 }], provisional: [] },
    });
    expect(result.decisions[0]?.resolution).toBe("new");
  });

  it("does not reuse a match explicitly marked provisional", () => {
    const result = normalizeResolution({
      candidates: [candidate],
      offeredKnowledge: [offered],
      resolution: { matches: [{ ...match, decision: "provisional" }], provisional: [] },
    });
    expect(result.decisions[0]?.resolution).toBe("new");
  });

  it("preserves an omitted original candidate", () => {
    const result = normalizeResolution({
      candidates: [candidate],
      offeredKnowledge: [offered],
      resolution: { matches: [], provisional: [] },
    });
    expect(result.decisions.map((item) => item.candidate.definition)).toEqual([
      candidate.definition,
    ]);
  });

  it("does not accept a provider rewrite of the extracted definition", () => {
    const result = normalizeResolution({
      candidates: [candidate],
      offeredKnowledge: [],
      resolution: {
        matches: [],
        provisional: [{ ...candidate, definition: "Ceremonial etiquette", reasonCodes: [] }],
      },
    });
    expect(result.decisions[0]?.candidate.definition).toBe(candidate.definition);
  });

  it("makes one new unit when the provider returns conflicting decisions", () => {
    const result = normalizeResolution({
      candidates: [candidate],
      offeredKnowledge: [offered],
      resolution: { matches: [match], provisional: [{ ...candidate, reasonCodes: [] }] },
    });
    expect(result.decisions).toHaveLength(1);
    expect(result.decisions[0]?.resolution).toBe("new");
  });

  it("rejects unoffered IDs and incompatible senses even at high confidence", () => {
    for (const choices of [[], [{ ...offered, semanticScope: "ceremonial conventions" }]]) {
      const result = normalizeResolution({
        candidates: [candidate],
        offeredKnowledge: choices,
        resolution: { matches: [match], provisional: [] },
      });
      expect(result.decisions[0]?.resolution).toBe("new");
    }
  });

  it("does not reuse matching semantic text with a conflicting structured definition scope", () => {
    // Given
    const scopedCandidate = {
      ...candidate,
      definitionScope: { domain: "mathematics", exclusions: ["ceremonial usage"] },
    };
    const scopedOffered = {
      ...offered,
      definitionScope: { domain: "social customs", exclusions: ["mathematical usage"] },
    };

    // When
    const result = normalizeResolution({
      candidates: [scopedCandidate],
      offeredKnowledge: [scopedOffered],
      resolution: { matches: [match], provisional: [] },
    });

    // Then
    expect(result.decisions[0]?.resolution).toBe("new");
  });

  it("records but never persists provider-invented candidate keys", () => {
    const result = normalizeResolution({
      candidates: [candidate],
      offeredKnowledge: [],
      resolution: {
        matches: [],
        provisional: [{ ...candidate, key: "invented", reasonCodes: [] }],
      },
    });
    expect(result.ignoredKeys).toEqual(["invented"]);
    expect(result.decisions.map((item) => item.candidate.key)).toEqual(["formal"]);
  });
});
