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

  it("skips an approval when any required criterion is false", () => {
    const result = normalizeResolution({
      artifacts: [artifact],
      offeredKnowledge: [],
      resolution: {
        matches: [],
        admissions: [{ ...admission, checks: { ...admission.checks, durableIdentity: false } }],
      },
    });

    expect(result.decisions[0]?.resolution).toBe("skip");
    expect(result.decisions[0]?.reasons).toContain("admission_criteria_failed");
  });

  it("skips source-supported claims whose reference was not offered", () => {
    const claim = {
      artifactType: "claim",
      key: "claim",
      label: "Deterministic transition",
      proposition: "One event selects one next state.",
      subjectDefinitionRevisionId: offered.revisionId,
      predicate: "selects",
      object: "one next state",
      evidentialScope: "deterministic controllers",
      provenanceStatus: "source_supported",
      provenanceBasis: "A source was cited by the model.",
      sourceRefs: ["invented:source"],
      riskScope: "stable",
      confidence: 0.9,
      sourceSpans: [],
    } satisfies z.infer<typeof admissionArtifactSchema>;
    const result = normalizeResolution({
      artifacts: [claim],
      offeredKnowledge: [offered],
      resolution: {
        matches: [],
        admissions: [
          {
            candidateKey: claim.key,
            artifactType: "claim",
            verdict: "approve",
            reviewLabel: "resolution-stage model review",
            checks: {
              subjectBindingMeaningful: true,
              relationExplicit: true,
              evidentialScopeHonest: true,
              reusable: true,
            },
            reasons: ["Structured claim."],
          },
        ],
      },
    });

    expect(result.decisions[0]?.resolution).toBe("skip");
    expect(result.decisions[0]?.reasons).toContain("claim_source_reference_unoffered");
  });

  it("admits a source-supported claim only when its exact reference was offered", () => {
    const claim = {
      artifactType: "claim",
      key: "claim",
      label: "Deterministic transition",
      proposition: "One event selects one next state.",
      subjectDefinitionRevisionId: offered.revisionId,
      predicate: "selects",
      object: "one next state",
      evidentialScope: "deterministic controllers",
      provenanceStatus: "source_supported",
      provenanceBasis: "The offered document states the relation.",
      sourceRefs: ["document:controller#transition"],
      riskScope: "stable",
      confidence: 0.9,
      sourceSpans: [],
    } satisfies z.infer<typeof admissionArtifactSchema>;
    const result = normalizeResolution({
      artifacts: [claim],
      offeredKnowledge: [
        {
          ...offered,
          claimDetails: [
            {
              text: "One event selects one next state.",
              authority: "external",
              sourceRefs: ["document:controller#transition"],
              status: "source_supported",
            },
          ],
        },
      ],
      resolution: {
        matches: [],
        admissions: [
          {
            candidateKey: claim.key,
            artifactType: "claim",
            verdict: "approve",
            reviewLabel: "resolution-stage model review",
            checks: {
              subjectBindingMeaningful: true,
              relationExplicit: true,
              evidentialScopeHonest: true,
              reusable: true,
            },
            reasons: ["Structured claim."],
          },
        ],
      },
    });

    expect(result.decisions[0]?.resolution).toBe("new_knowledge");
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
