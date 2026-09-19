import { describe, expect, it } from "vitest";
import {
  type ProjectionEvidence,
  type ProjectionInput,
  projectKnowledge,
} from "../../src/server/learner-projection.js";

const evidence: ProjectionEvidence = {
  id: "e1",
  knowledgeRevisionId: "r1",
  dimension: "explanation",
  evidenceType: "free_explanation",
  score: 0.95,
  evaluatorConfidence: 0.9,
  polarity: "positive",
  assistance: { hints: 0, answerVisible: false, openBook: false, copiedFromRecentContext: false },
  createdAt: "2026-09-19T00:00:00.000Z",
};
const base: ProjectionInput = {
  knowledgeRevisionId: "r1",
  evidence: [],
  exposures: [],
  corrections: [],
  now: "2026-09-19T12:00:00.000Z",
};

describe("revision-scoped learner state projection", () => {
  it("keeps mastery unknown when only tutor exposure exists", () => {
    const state = projectKnowledge({
      ...base,
      exposures: [{ knowledgeRevisionId: "r1", createdAt: base.now }],
    });
    expect(state.dimensions.recognition.status).toBe("exposed");
    expect(state.dimensions.explanation.status).toBe("unknown");
    expect(state.dimensions.explanation.effectiveEvidence).toBe(0);
    expect(state.evidenceIds).toEqual([]);
  });

  it("updates only the dimension demonstrated by the learner", () => {
    const state = projectKnowledge({ ...base, evidence: [evidence] });
    expect(state.dimensions.explanation.estimate).toBeGreaterThan(0.5);
    expect(state.dimensions.application.status).toBe("unknown");
    expect(state.dimensions.transfer.effectiveEvidence).toBe(0);
  });

  it("reduces the estimate for negative evidence", () => {
    const state = projectKnowledge({
      ...base,
      evidence: [{ ...evidence, score: 0.05, polarity: "negative" }],
    });
    expect(state.dimensions.explanation.estimate).toBeLessThan(0.5);
  });

  it("weights self-report less than an independent explanation", () => {
    const strong = projectKnowledge({ ...base, evidence: [evidence] });
    const weak = projectKnowledge({
      ...base,
      evidence: [{ ...evidence, evidenceType: "self_report" }],
    });
    expect(weak.dimensions.explanation.effectiveEvidence).toBeLessThan(
      strong.dimensions.explanation.effectiveEvidence / 3,
    );
  });

  it("discounts hints, visible answers and copied context", () => {
    const state = projectKnowledge({
      ...base,
      evidence: [
        {
          ...evidence,
          assistance: {
            hints: 3,
            answerVisible: true,
            openBook: true,
            copiedFromRecentContext: true,
          },
        },
      ],
    });
    expect(state.dimensions.explanation.effectiveEvidence).toBeLessThan(0.01);
    expect(state.dimensions.explanation.status).toBe("tentative");
  });

  it("does not migrate old evidence to a new definition", () => {
    const state = projectKnowledge({ ...base, knowledgeRevisionId: "r2", evidence: [evidence] });
    expect(state.dimensions.explanation.status).toBe("unknown");
    expect(state.evidenceIds).toEqual([]);
  });

  it("excludes invalidated evidence without deleting the source", () => {
    const state = projectKnowledge({
      ...base,
      evidence: [evidence],
      corrections: [{ type: "evidence_invalid", evidenceId: evidence.id, createdAt: base.now }],
    });
    expect(state.dimensions.explanation.effectiveEvidence).toBe(0);
    expect(evidence.score).toBe(0.95);
  });

  it("reduces uncertainty with independent observations", () => {
    const state = projectKnowledge({
      ...base,
      evidence: [evidence, { ...evidence, id: "e2" }, { ...evidence, id: "e3" }],
    });
    expect(state.dimensions.explanation.status).toBe("supported");
    expect(state.dimensions.explanation.uncertainty).toBeLessThan(0.5);
  });

  it("marks old supported observations stale without losing provenance", () => {
    const state = projectKnowledge({
      ...base,
      now: "2027-09-19T12:00:00.000Z",
      evidence: [evidence, { ...evidence, id: "e2" }, { ...evidence, id: "e3" }],
    });
    expect(state.dimensions.explanation.status).toBe("stale");
    expect(state.evidenceIds).toEqual(["e1", "e2", "e3"]);
  });

  it("keeps ambiguous observations weak", () => {
    const state = projectKnowledge({
      ...base,
      evidence: [{ ...evidence, polarity: "ambiguous" }],
    });
    expect(state.dimensions.explanation.estimate).toBeLessThan(0.52);
  });

  it("rebuilds identically from the same evidence and clock", () => {
    const input = { ...base, evidence: [evidence] };
    expect(projectKnowledge(input)).toEqual(projectKnowledge(input));
  });

  it("never marks unverified contested or high-stakes knowledge supported", () => {
    for (const riskScope of ["current-contested", "high-stakes"] as const) {
      const state = projectKnowledge({
        ...base,
        authority: "provisional",
        riskScope,
        evidence: Array.from({ length: 20 }, (_, index) => ({ ...evidence, id: `e${index}` })),
      });
      expect(state.dimensions.explanation.status).toBe("tentative");
      expect(state.dimensions.explanation.uncertainty).toBeGreaterThanOrEqual(0.6);
      expect(state.evidenceIds).toHaveLength(20);
    }
  });

  it("weakly acknowledges a knowledge claim without inventing mastery evidence", () => {
    const state = projectKnowledge({
      ...base,
      corrections: [{ type: "claims_more_knowledge", createdAt: base.now }],
    });
    expect(state.dimensions.recognition.uncertainty).toBe(0.95);
    expect(state.dimensions.recognition.estimate).toBe(0.5);
    expect(state.dimensions.recognition.status).toBe("unknown");
    expect(state.dimensions.recognition.effectiveEvidence).toBe(0);
    expect(state.evidenceIds).toEqual([]);
    expect(state.dimensions.explanation.uncertainty).toBe(1);
  });
});
