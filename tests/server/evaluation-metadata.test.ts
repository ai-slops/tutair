import { expect, it } from "vitest";
import { z } from "zod";
import { evaluatedSchema } from "../../src/server/evaluation-schema.js";
import { STAGE_SCHEMA_VERSIONS, STAGE_VERSIONS } from "../../src/server/model-context-version.js";

it("parses shipped evaluation outputs with empty metadata defaults", () => {
  // Given
  const shipped = { evidence: [], openQuestion: "Try a counterexample" };

  // When
  const parsed = evaluatedSchema.parse(shipped);

  // Then
  expect(parsed).toEqual({
    evidence: [],
    openQuestion: "Try a counterexample",
    unresolvedAmbiguities: [],
    suggestedFollowup: null,
  });
});

it("accepts bounded structured ambiguity and followup metadata", () => {
  // Given
  const knowledgeUnitId = "123e4567-e89b-42d3-a456-426614174000";

  // When
  const parsed = evaluatedSchema.parse({
    evidence: [],
    openQuestion: null,
    unresolvedAmbiguities: ["The learner may be describing implementation state."],
    suggestedFollowup: {
      knowledgeUnitId,
      dimension: "discrimination",
      method: "request_contrast",
    },
  });

  // Then
  expect(parsed.suggestedFollowup).toEqual({
    knowledgeUnitId,
    dimension: "discrimination",
    method: "request_contrast",
  });
});

it("rejects fictional followup references and unbounded ambiguity metadata", () => {
  // Given
  const invalid = {
    evidence: [],
    openQuestion: null,
    unresolvedAmbiguities: Array.from({ length: 17 }, () => "ambiguous"),
    suggestedFollowup: {
      knowledgeUnitId: "invented-unit",
      dimension: "application",
      method: "invented_method",
    },
  };

  // When
  const parsed = evaluatedSchema.safeParse(invalid);

  // Then
  expect(parsed.success).toBe(false);
});

it("versions only the changed evaluation stage while retaining unrelated stage versions", () => {
  expect(STAGE_VERSIONS).toEqual({
    extraction: "phase1-v1",
    resolution: "phase1-v1",
    planning: "phase1-v1",
    draft: "phase1-v1",
    lint: "phase1-v1",
    final: "phase1-v1",
    evaluation: "phase1-evaluation-v2",
  });
  expect(z.record(z.string(), z.string()).parse(STAGE_VERSIONS)["evaluation"]).not.toBe(
    "phase1-v1",
  );
});

it("versions schemas only for stages whose output contracts changed", () => {
  expect(STAGE_SCHEMA_VERSIONS).toEqual({
    extraction: "phase1-schema-v3",
    resolution: "phase1-schema-v3",
    planning: "phase1-schema-v2",
    draft: "phase1-schema-v2",
    lint: "phase1-schema-v3",
    final: "phase1-schema-v2",
    evaluation: "phase1-evaluation-schema-v3",
  });
});
