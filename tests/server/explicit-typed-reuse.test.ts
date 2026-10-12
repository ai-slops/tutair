import { describe, expect, it } from "vitest";
import type { z } from "zod";
import { normalizeResolution } from "../../src/server/resolution-policy.js";
import type { KnowledgeContext } from "../../src/server/tutor-knowledge.js";
import type { admissionArtifactSchema, resolutionSchema } from "../../src/server/tutor-schemas.js";

type Artifact = z.infer<typeof admissionArtifactSchema>;
type ClaimArtifact = Extract<Artifact, { readonly artifactType: "claim" }>;
type DistinctionArtifact = Extract<Artifact, { readonly artifactType: "distinction" }>;

const subjectA = "11111111-1111-4111-8111-111111111111";
const subjectB = "22222222-2222-4222-8222-222222222222";
const claimId = "33333333-3333-4333-8333-333333333333";
const claimRevisionId = "44444444-4444-4444-8444-444444444444";

const claim = {
  artifactType: "claim",
  key: "state-persists",
  label: "State persistence",
  proposition: "A state persists until an event causes a transition.",
  subjectDefinitionRevisionId: subjectA,
  predicate: "persists until",
  object: "a transition-triggering event",
  evidentialScope: "finite-state machines",
  provenanceStatus: "model_generated",
  provenanceBasis: "Generated for later review.",
  sourceRefs: [],
  riskScope: "stable",
  confidence: 0.95,
  sourceSpans: [],
} satisfies ClaimArtifact;

const distinction = {
  artifactType: "distinction",
  key: "state-vs-event",
  label: "State versus event",
  definitionRevisionIds: [subjectA, subjectB],
  criterion: "whether the value persists after the trigger",
  contrast: "A state persists; an event triggers change.",
  riskScope: "stable",
  confidence: 0.95,
  sourceSpans: [],
} satisfies DistinctionArtifact;

const match = (artifact: Artifact, knowledgeId: string, revision = 1) =>
  ({
    candidateKey: artifact.key,
    knowledgeId,
    revision,
    confidence: 0.99,
    decision: "semantic",
    reasonCodes: ["same_kind"],
  }) satisfies z.infer<typeof resolutionSchema>["matches"][number];

const definitionContext = (revisionId: string): KnowledgeContext => ({
  id: crypto.randomUUID(),
  title: "Definition",
  scope: "provisional",
  revision: 1,
  revisionId,
  definition: "A reusable definition.",
  semanticScope: "finite-state machines",
  distinguishingFeatures: [],
  claims: [],
  riskScope: "stable",
  kind: "concept",
  aliases: [],
});

const claimContext = (
  typedContract?: ClaimArtifact,
): KnowledgeContext & { readonly typedContract?: ClaimArtifact } => ({
  id: claimId,
  title: claim.label,
  scope: "provisional",
  revision: 1,
  revisionId: claimRevisionId,
  definition: claim.proposition,
  semanticScope: claim.evidentialScope,
  distinguishingFeatures: [claim.predicate, claim.object],
  claims: [claim.proposition],
  riskScope: "stable",
  kind: "claim",
  aliases: [],
  ...(typedContract === undefined ? {} : { typedContract }),
});

describe("explicit typed knowledge reuse", () => {
  it("rejects a legacy claim match without a typed contract", () => {
    const result = normalizeResolution({
      artifacts: [claim],
      offeredKnowledge: [definitionContext(subjectA), claimContext()],
      resolution: { matches: [match(claim, claimId)], admissions: [] },
    });

    expect(result.decisions[0]?.resolution).toBe("skip");
    expect(result.decisions[0]?.reasons).not.toContain("typed_contract_compatible");
  });

  it("rejects a claim match bound to a different subject", () => {
    const candidate = { ...claim, subjectDefinitionRevisionId: subjectB } satisfies ClaimArtifact;
    const result = normalizeResolution({
      artifacts: [candidate],
      offeredKnowledge: [definitionContext(subjectB), claimContext(claim)],
      resolution: { matches: [match(candidate, claimId)], admissions: [] },
    });

    expect(result.decisions[0]?.resolution).toBe("skip");
    expect(result.decisions[0]?.reasons).not.toContain("typed_contract_compatible");
  });

  it("rejects a distinction match with reversed directional endpoints", () => {
    const candidate = {
      ...distinction,
      definitionRevisionIds: [subjectB, subjectA],
    } satisfies DistinctionArtifact;
    const offeredDistinction = {
      ...claimContext(),
      kind: "distinction",
      typedContract: distinction,
    } satisfies KnowledgeContext & { readonly typedContract: DistinctionArtifact };
    const result = normalizeResolution({
      artifacts: [candidate],
      offeredKnowledge: [
        definitionContext(subjectA),
        definitionContext(subjectB),
        offeredDistinction,
      ],
      resolution: { matches: [match(candidate, offeredDistinction.id)], admissions: [] },
    });

    expect(result.decisions[0]?.resolution).toBe("skip");
  });

  it("accepts matching typed semantics despite different ephemeral presentation fields", () => {
    const candidate = {
      ...claim,
      key: "new-key",
      label: "Reworded label",
      confidence: 0.91,
      sourceSpans: [{ start: 0, end: 3 }],
    } satisfies ClaimArtifact;
    const result = normalizeResolution({
      artifacts: [candidate],
      offeredKnowledge: [definitionContext(subjectA), claimContext(claim)],
      resolution: { matches: [match(candidate, claimId)], admissions: [] },
    });

    expect(result.decisions[0]?.resolution).toBe("reuse");
    expect(result.decisions[0]?.reasons).toContain("typed_contract_compatible");
  });
});
