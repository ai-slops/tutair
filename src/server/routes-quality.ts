import { Hono } from "hono";
import { z } from "zod";
import { jsonBody, ownerFor, type Services } from "./context.js";
import { isoNow, newId } from "./types.js";

const metricNames = [
  "extraction_correct",
  "provisional_duplicate",
  "incorrect_merge",
  "evaluator_agreement",
  "unnecessary_diagnostic",
  "missed_prerequisite",
  "answer_abandoned",
  "predicted_correctness",
  "contradictory_evidence",
] as const;
const metricSchema = z.enum(metricNames);
const labeledSample = z.object({
  metric: metricSchema,
  value: z.number().min(0).max(1),
  prediction: z.number().min(0).max(1).nullable(),
});
const observationSchema = labeledSample
  .extend({
    messageId: z.string().uuid(),
    prediction: z.number().min(0).max(1).nullable().default(null),
    note: z.string().max(2000).default(""),
  })
  .strict()
  .refine(
    (observation) =>
      observation.metric !== "predicted_correctness" ||
      (observation.prediction !== null && (observation.value === 0 || observation.value === 1)),
    { message: "Prediction outcomes require a probability and binary observed correctness" },
  );
const storedObservation = observationSchema.safeExtend({
  id: z.string(),
  learner_id: z.string(),
  message_id: z.string(),
  synthetic: z.number().int(),
  created_at: z.string(),
});

export function summarizeQuality(samples: readonly z.infer<typeof labeledSample>[]) {
  const metrics = metricNames.map((metric) => {
    const observations = samples.filter((sample) => sample.metric === metric);
    return {
      metric,
      samples: observations.length,
      mean:
        observations.length === 0
          ? null
          : observations.reduce((sum, sample) => sum + sample.value, 0) / observations.length,
    };
  });
  const predictions = samples.filter(
    (sample) => sample.metric === "predicted_correctness" && sample.prediction !== null,
  );
  return {
    metrics,
    calibrationBrierScore:
      predictions.length === 0
        ? null
        : predictions.reduce(
            (sum, sample) => sum + (sample.value - (sample.prediction ?? 0)) ** 2,
            0,
          ) / predictions.length,
  };
}

export function qualityRoutes(services: Services): Hono {
  services.db.raw.exec(`
    CREATE TABLE IF NOT EXISTS quality_observations (
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      metric TEXT NOT NULL, value REAL NOT NULL, prediction REAL,
      synthetic INTEGER NOT NULL, note TEXT NOT NULL, created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS quality_owner ON quality_observations(learner_id,metric);
  `);
  const app = new Hono();
  app.post("/quality/observations", async (c) => {
    const owner = ownerFor(c, services);
    const input = observationSchema.parse(await jsonBody(c));
    const message = services.core.message(owner, input.messageId);
    const id = newId();
    const createdAt = isoNow();
    services.db.run("INSERT INTO quality_observations VALUES(?,?,?,?,?,?,?,?,?)", [
      id,
      owner,
      input.messageId,
      input.metric,
      input.value,
      input.prediction,
      message.synthetic,
      input.note,
      createdAt,
    ]);
    return c.json(
      { observation: { id, ...input, synthetic: message.synthetic === 1, createdAt } },
      201,
    );
  });
  app.get("/quality", (c) => {
    const owner = ownerFor(c, services);
    const includeSynthetic = c.req.query("includeSynthetic") === "true";
    const samples = services.db.all(
      "SELECT metric,value,prediction FROM quality_observations WHERE learner_id=? AND (?=1 OR synthetic=0)",
      [owner, includeSynthetic ? 1 : 0],
      labeledSample,
    );
    const corrections = services.db.one(
      "SELECT COUNT(*) AS count FROM corrections WHERE learner_id=?",
      [owner],
      z.object({ count: z.number() }),
    );
    return c.json({
      ...summarizeQuality(samples),
      userCorrectionCount: corrections?.count ?? 0,
      includeSynthetic,
      method: "manual_labels_v1",
    });
  });
  app.get("/quality/observations", (c) => {
    const owner = ownerFor(c, services);
    const observations = services.db.all(
      "SELECT *,message_id AS messageId FROM quality_observations WHERE learner_id=? ORDER BY created_at",
      [owner],
      storedObservation,
    );
    return c.json({ observations });
  });
  return app;
}
