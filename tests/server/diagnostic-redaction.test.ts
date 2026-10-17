import { expect, it } from "vitest";
import { redactDiagnostic } from "../../src/server/diagnostic-redaction.js";

it("redacts generic credential assignments in diagnostic text", () => {
  const redacted = redactDiagnostic(
    "authorization=first api_key:second token=third credential:fourth",
  );

  expect(redacted).toBe("[redacted] [redacted] [redacted] [redacted]");
});
