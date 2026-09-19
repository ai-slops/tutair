import { afterEach, beforeEach, expect, it } from "vitest";
import { createBackendHarness, post } from "./backend-harness.js";

const harness = createBackendHarness();
beforeEach(harness.reset);
afterEach(harness.cleanup);

it("downloads a private learning archive instead of navigating away from the workspace", async () => {
  const { client } = harness.setup();
  await client.call("/api/auth/local-signup", post({ displayName: "Export learner" }));
  const response = await client.call("/api/export");
  expect(response.status).toBe(200);
  expect(response.headers.get("content-disposition")).toBe(
    'attachment; filename="tutair-learning-export.json"',
  );
  expect(response.headers.get("cache-control")).toBe("no-store");
});
