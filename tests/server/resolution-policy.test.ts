import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { normalizeResolution } from "../../src/server/resolution-policy.js";
import type { KnowledgeContext } from "../../src/server/tutor-knowledge.js";
import type { admissionArtifactSchema, resolutionSchema } from "../../src/server/tutor-schemas.js";

const artifact = {
  artifactType: "definition",
  key: "formal",
  label: "formal",
  definition: "Explicit components and rules",
  semanticScope: "computer science",
  definitionKind: "term_sense",
  aliases: [],
  distinguishingFeatures: ["explicit rules"],
  riskScope: "stable",
  confidence: 0.9,
  sourceSpans: [],
} satisfies z.infer<typeof admissionArtifactSchema>;

const offered: KnowledgeContext = {
  id: "11111111-1111-4111-8111-111111111111",
  title: "formal",
  scope: "canonical",
  revision: 1,
  revisionId: "22222222-2222-4222-8222-222222222222",
  definition: artifact.definition,
  semanticScope: artifact.semanticScope,
  distinguishingFeatures: [],
  claims: [],
  riskScope: "stable",
  kind: "term_sense",
  aliases: [],
};

const match = {
  candidateKey: artifact.key,
  knowledgeId: offered.id,
  revision: offered.revision,
  confidence: 0.99,
  decision: "semantic",
  reasonCodes: ["same_scope"],
} satisfies z.infer<typeof resolutionSchema>["matches"][number];

const admission = {
  candidateKey: artifact.key,
  artifactType: "definition",
  verdict: "approve",
  reviewLabel: "resolution-stage model review",
  rubricVersion: "typed-admission-v1",
  checks: { durableIdentity: true, boundedMeaning: true, reusableBeyondCurrentAnswer: true },
  reasons: ["Durable named definition."],
} satisfies z.infer<typeof resolutionSchema>["admissions"][number];

describe("conservative typed resolution", () => {
  it("reuses only an offered compatible revision with strong confidence", () => {
    const accepted = normalizeResolution({
      artifacts: [artifact],
      offeredKnowledge: [offered],
      resolution: { matches: [match], admissions: [] },
    });
    const uncertain = normalizeResolution({
      artifacts: [artifact],
      offeredKnowledge: [offered],
      resolution: { matches: [{ ...match, confidence: 0.05 }], admissions: [] },
    });
    expect(accepted.decisions[0]?.resolution).toBe("reuse");
    expect(uncertain.decisions[0]?.resolution).toBe("skip");
  });

  it("creates only a matching approved typed admission", () => {
    const accepted = normalizeResolution({
      artifacts: [artifact],
      offeredKnowledge: [],
      resolution: { matches: [], admissions: [admission] },
    });
    const rejected = normalizeResolution({
      artifacts: [artifact],
      offeredKnowledge: [],
      resolution: { matches: [], admissions: [{ ...admission, verdict: "reject" }] },
    });
    expect(accepted.decisions[0]?.resolution).toBe("new_knowledge");
    expect(rejected.decisions[0]?.resolution).toBe("skip");
  });

  it("skips conflicting decisions and records provider-invented keys", () => {
    const result = normalizeResolution({
      artifacts: [artifact],
      offeredKnowledge: [offered],
      resolution: {
        matches: [match],
        admissions: [admission, { ...admission, candidateKey: "invented" }],
      },
    });
    expect(result.decisions[0]?.resolution).toBe("skip");
    expect(result.ignoredKeys).toEqual(["invented"]);
  });
});
