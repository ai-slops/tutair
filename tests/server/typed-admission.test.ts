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

  it("requires every kind-specific model-review check to be true", () => {
    const rejected = {
      candidateKey: definition.key,
      artifactType: definition.artifactType,
      verdict: "approve",
      reviewLabel: "resolution-stage model review",
      rubricVersion: "typed-admission-v1",
      checks: { ...definitionChecks, durableIdentity: false },
      reasons: ["This is a contextual heading, not a durable identity."],
    };

    expect(resolutionSchema.safeParse({ matches: [], admissions: [rejected] }).success).toBe(false);
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
      sourceRefs: ["source:learner-question"],
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
