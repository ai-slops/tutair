import { describe, expect, it } from "vitest";
import {
  turnRequestIdentity,
  tutorTurnRequestSchema,
} from "../../src/server/turn-request-schema.js";

describe("turn request identity", () => {
  it("distinguishes canonically similar source content after schema trimming", () => {
    // Given
    const composed = tutorTurnRequestSchema.parse({ content: "  café  " });
    const decomposed = tutorTurnRequestSchema.parse({ content: "cafe\u0301" });

    // When
    const first = turnRequestIdentity(composed);
    const second = turnRequestIdentity(decomposed);

    // Then
    expect(composed.content).toBe("café");
    expect(first.baseHash).not.toBe(second.baseHash);
  });
});
