import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CoreRepository } from "../../src/server/repository-core.js";
import { createBackendHarness, makeClient, post } from "./backend-harness.js";

const summarySchema = z.object({
  metrics: z.array(
    z.object({ metric: z.string(), samples: z.number(), mean: z.number().nullable() }),
  ),
  calibrationBrierScore: z.number().nullable(),
});

describe("assembled quality API", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  it("excludes synthetic labels by default and reports their measured values only on request", async () => {
    const { client, database, app } = harness.setup();
    const { learner } = z
      .object({ learner: z.object({ id: z.string() }) })
      .parse(await client.json("/api/auth/local-signup", post({})));
    const { conversation } = z
      .object({ conversation: z.object({ id: z.string() }) })
      .parse(await client.json("/api/conversations", post({})));
    const message = z
      .object({ id: z.string() })
      .parse(
        new CoreRepository(database).createMessage(
          learner.id,
          conversation.id,
          "tutor",
          "Synthetic",
          true,
        ),
      );
    expect(
      (
        await client.call(
          "/api/quality/observations",
          post({
            messageId: message.id,
            metric: "predicted_correctness",
            value: 1,
            prediction: 0.8,
          }),
        )
      ).status,
    ).toBe(201);
    const measured = summarySchema.parse(await client.json("/api/quality?includeSynthetic=true"));
    expect(measured.metrics.find((metric) => metric.metric === "predicted_correctness")).toEqual({
      metric: "predicted_correctness",
      samples: 1,
      mean: 1,
    });
    expect(measured.calibrationBrierScore).toBeCloseTo(0.04);
    expect(summarySchema.parse(await client.json("/api/quality")).calibrationBrierScore).toBeNull();
    const other = makeClient(app);
    await other.call("/api/auth/local-signup", post({}));
    expect(
      summarySchema
        .parse(await other.json("/api/quality?includeSynthetic=true"))
        .metrics.every((metric) => metric.samples === 0 && metric.mean === null),
    ).toBe(true);
    expect(
      (
        await other.call(
          "/api/quality/observations",
          post({
            messageId: message.id,
            metric: "extraction_correct",
            value: 1,
          }),
        )
      ).status,
    ).toBe(404);
  });
});
