import { describe, expect, it } from "vitest";
import { admissionArtifactSchema, resolutionSchema } from "../../src/server/tutor-schemas.js";

const definitionRevisionId = "11111111-1111-4111-8111-111111111111";

const definition = {
  artifactType: "definition",
  key: "state",
  label: "state",
  definitionKind: "concept",
  definition: "A modeled configuration relevant to future behavior.",
  semanticScope: "finite-state systems",
  aliases: [],
  distinguishingFeatures: ["future behavior"],
  riskScope: "stable",
  confidence: 0.9,
  sourceSpans: [],
} as const;

const definitionChecks = {
  durableIdentity: true,
  boundedMeaning: true,
  reusableBeyondCurrentAnswer: true,
} as const;

const definitionAdmission = {
  candidateKey: definition.key,
  artifactType: definition.artifactType,
  verdict: "approve",
  reviewLabel: "resolution-stage model review",
  checks: definitionChecks,
  reasons: ["Durable named definition."],
} as const;

describe("typed artifact admission", () => {
  it("does not let a generic boolean admit a definition", () => {
    const legacy = {
      ...definition,
      review: "create",
      independentlyValidated: true,
      reasonCodes: ["looks useful"],
    };

    expect(resolutionSchema.safeParse({ matches: [], admissions: [legacy] }).success).toBe(false);
  });

  it("parses a rejected review with a false kind-specific check", () => {
    const rejected = {
      candidateKey: definition.key,
      artifactType: definition.artifactType,
      verdict: "approve",
      reviewLabel: "resolution-stage model review",
      checks: { ...definitionChecks, durableIdentity: false },
      reasons: ["This is a contextual heading, not a durable identity."],
    };

    expect(resolutionSchema.safeParse({ matches: [], admissions: [rejected] }).success).toBe(true);
  });

  it("keeps the admission rubric version server-owned", () => {
    expect(
      resolutionSchema.safeParse({
        matches: [],
        admissions: [{ ...definitionAdmission, rubricVersion: "model-asserted-rubric" }],
      }).success,
    ).toBe(false);
  });

  it("rejects missing and additional kind-specific checks", () => {
    const { boundedMeaning: _boundedMeaning, ...missingCheck } = definitionChecks;
    expect(
      resolutionSchema.safeParse({
        matches: [],
        admissions: [{ ...definitionAdmission, checks: missingCheck }],
      }).success,
    ).toBe(false);
    expect(
      resolutionSchema.safeParse({
        matches: [],
        admissions: [
          { ...definitionAdmission, checks: { ...definitionChecks, inventedCriterion: true } },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires claims and distinctions to pin exact definition revisions", () => {
    const claim = {
      artifactType: "claim",
      key: "transition-determinism",
      label: "Deterministic transitions select one next state",
      proposition:
        "For one state and event, a deterministic transition function selects one next state.",
      subjectDefinitionRevisionId: definitionRevisionId,
      predicate: "selects",
      object: "one next state",
      evidentialScope: "deterministic finite-state machines",
      provenanceStatus: "model_generated",
      provenanceBasis: "Generated from the current question and retained as provisional.",
      sourceRefs: [],
      riskScope: "stable",
      confidence: 0.9,
      sourceSpans: [],
    };
    const distinction = {
      artifactType: "distinction",
      key: "state-vs-event",
      label: "State and event",
      definitionRevisionIds: [definitionRevisionId],
      criterion: "role in transition semantics",
      contrast: "A state persists as configuration; an event triggers a transition.",
      riskScope: "stable",
      confidence: 0.9,
      sourceSpans: [],
    };

    expect(admissionArtifactSchema.safeParse(claim).success).toBe(true);
    expect(
      admissionArtifactSchema.safeParse({ ...claim, subjectDefinitionRevisionId: undefined })
        .success,
    ).toBe(false);
    expect(admissionArtifactSchema.safeParse(distinction).success).toBe(false);
  });

  it("separates generated claim basis from source-supported references", () => {
    const claim = {
      artifactType: "claim",
      key: "transition-determinism",
      label: "Deterministic transition",
      proposition: "One state and event select one next state.",
      subjectDefinitionRevisionId: definitionRevisionId,
      predicate: "selects",
      object: "one next state",
      evidentialScope: "deterministic finite-state machines",
      provenanceStatus: "model_generated",
      provenanceBasis: "Generated as a provisional relation from the current question.",
      sourceRefs: [],
      riskScope: "stable",
      confidence: 0.9,
      sourceSpans: [],
    } as const;

    expect(admissionArtifactSchema.safeParse(claim).success).toBe(true);
    expect(
      admissionArtifactSchema.safeParse({ ...claim, sourceRefs: ["invented:source"] }).success,
    ).toBe(false);
    expect(
      admissionArtifactSchema.safeParse({
        ...claim,
        provenanceStatus: "source_supported",
        sourceRefs: [],
      }).success,
    ).toBe(false);
  });

  it("accepts a source-supported claim with explicit references and basis", () => {
    expect(
      admissionArtifactSchema.safeParse({
        artifactType: "claim",
        key: "supported-transition",
        label: "Supported transition",
        proposition: "The transition is deterministic.",
        subjectDefinitionRevisionId: definitionRevisionId,
        predicate: "is",
        object: "deterministic",
        evidentialScope: "the offered controller definition",
        provenanceStatus: "source_supported",
        provenanceBasis: "The offered source explicitly defines one next state.",
        sourceRefs: ["document:controller#transition"],
        riskScope: "stable",
        confidence: 0.9,
        sourceSpans: [],
      }).success,
    ).toBe(true);
  });

  it("requires an explicit provenance basis for generated claims", () => {
    expect(
      admissionArtifactSchema.safeParse({
        artifactType: "claim",
        key: "unsupported-transition",
        label: "Unsupported transition",
        proposition: "The transition is deterministic.",
        subjectDefinitionRevisionId: definitionRevisionId,
        predicate: "is",
        object: "deterministic",
        evidentialScope: "finite-state systems",
        provenanceStatus: "model_generated",
        provenanceBasis: "",
        sourceRefs: [],
        riskScope: "stable",
        confidence: 0.9,
        sourceSpans: [],
      }).success,
    ).toBe(false);
  });

  it("parses an approval with a false criterion for policy-level rejection", () => {
    const parsed = resolutionSchema.safeParse({
      matches: [],
      admissions: [
        {
          ...definitionAdmission,
          checks: { ...definitionChecks, boundedMeaning: false },
        },
      ],
    });

    expect(parsed.success).toBe(true);
  });

  it("requires misconception links to explain specific learning value", () => {
    const misconception = {
      artifactType: "misconception",
      key: "states-are-events",
      label: "States are events",
      mistakenProposition: "A state is the event that causes a transition.",
      correction: "A state is a configuration; an event can trigger a transition.",
      failureTask: "Trace the controller after a coin event.",
      likelyError: "The learner labels coin as a state.",
      discriminatingExample: {
        scenario: "A locked turnstile receives a coin.",
        mistakenResponse: "Coin is the new state.",
        correctedResponse: "Unlocked is the new state; coin is the event.",
        decisiveCue: "The value that persists after the trigger is the state.",
      },
      reuseValueReason: "This confusion recurs across event-driven models.",
      definitionRevisionLinks: [
        { definitionRevisionId, role: "subject", learningValue: "helpful" },
      ],
      riskScope: "stable",
      confidence: 0.9,
      sourceSpans: [],
    };

    expect(admissionArtifactSchema.safeParse(misconception).success).toBe(false);
  });
});
