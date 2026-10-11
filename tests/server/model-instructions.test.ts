import { expect, it } from "vitest";
import { modelInstruction } from "../../src/server/model-instructions.js";

it("requires globally unique extraction keys across candidate categories", () => {
  expect(modelInstruction("extraction")).toContain(
    "Every candidate key must be globally unique across all candidate category arrays, including material requests.",
  );
});
