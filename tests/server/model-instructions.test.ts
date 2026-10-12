import { expect, it } from "vitest";
import { modelInstruction, modelStageProtocols } from "../../src/server/model-instructions.js";

it("routes every model stage through its versioned protocol", () => {
  const stages = [
    "extraction",
    "resolution",
    "planning",
    "preparation",
    "draft",
    "lint",
    "final",
    "evaluation",
  ] as const;
  expect(modelStageProtocols).toEqual({
    extraction: "typed-artifacts-v1",
    resolution: "typed-admission-v1",
    planning: "typed-planning-v1",
    preparation: "typed-materials-v1",
    draft: "grounded-draft-v1",
    lint: "grounded-lint-v1",
    final: "block-selection-v1",
    evaluation: "evidence-v1",
  });
  expect(stages.every((stage) => modelInstruction(stage).length > 0)).toBe(true);
});
