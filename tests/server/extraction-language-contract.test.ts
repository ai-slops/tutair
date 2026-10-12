import { expect, it } from "vitest";
import { extractionSchema } from "../../src/server/tutor-schemas.js";
import { machine } from "./tutor-test-fixtures.js";

it("requires explicit source and response languages without an English default", () => {
  const extraction = {
    goal: "Explain the requested topic.",
    sourceLanguage: "ko",
    responseLanguage: "ko",
    artifacts: [machine],
    relations: [],
  };
  const { sourceLanguage: _sourceLanguage, ...withoutSourceLanguage } = extraction;
  const { responseLanguage: _responseLanguage, ...withoutResponseLanguage } = extraction;

  expect(extractionSchema.safeParse(extraction).success).toBe(true);
  expect(extractionSchema.safeParse(withoutSourceLanguage).success).toBe(false);
  expect(extractionSchema.safeParse(withoutResponseLanguage).success).toBe(false);
});
