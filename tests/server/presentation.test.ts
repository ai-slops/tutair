import { describe, expect, it } from "vitest";
import { presentJson } from "../../src/server/presentation.js";

describe("database row presentation", () => {
  it("preserves arbitrary structured model output exactly", () => {
    // Given
    const output = {
      role: "learner",
      learner_explanation: { source_message: "unchanged", nested_value: 3 },
    };

    // When
    const presented = presentJson({ run_id: "run", output_json: JSON.stringify(output) });

    // Then
    expect(presented).toEqual({ runId: "run", outputJson: output, output });
  });
});
