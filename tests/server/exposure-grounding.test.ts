import { describe, expect, it } from "vitest";
import { exposureGroundingFailure } from "../../src/server/exposure-grounding.js";

const knowledgeId = "11111111-1111-4111-8111-111111111111";
const allowed = new Set([knowledgeId]);
describe("exposure annotation validation", () => {
  it("accepts only an exact unique quote from the final answer", () => {
    expect(
      exposureGroundingFailure(
        "A state is a snapshot.",
        { knowledgeId, sourceQuote: "A state is a snapshot." },
        allowed,
      ),
    ).toBeNull();
    expect(
      exposureGroundingFailure(
        "A state is a snapshot.",
        { knowledgeId, sourceQuote: "A state is a memory." },
        allowed,
      ),
    ).toBe("quote_not_found");
  });
  it("rejects ambiguous quotes and unauthorized IDs", () => {
    expect(
      exposureGroundingFailure("state state", { knowledgeId, sourceQuote: "state" }, allowed),
    ).toBe("ambiguous_quote");
    expect(
      exposureGroundingFailure("state", { knowledgeId, sourceQuote: "state" }, new Set()),
    ).toBe("unapproved_unit");
  });
  it("rejects reversed ranges and split UTF-16 code points", () => {
    expect(
      exposureGroundingFailure("state", { knowledgeId, sourceSpan: { start: 4, end: 2 } }, allowed),
    ).toBe("invalid_span");
    expect(
      exposureGroundingFailure("a😀b", { knowledgeId, sourceSpan: { start: 1, end: 2 } }, allowed),
    ).toBe("split_code_point");
    expect(
      exposureGroundingFailure("a😀b", { knowledgeId, sourceSpan: { start: 1, end: 3 } }, allowed),
    ).toBeNull();
  });
});
