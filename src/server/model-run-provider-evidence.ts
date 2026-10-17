import { z } from "zod";
import type { Database } from "./database.js";
import { ProviderCallError } from "./provider.js";
import type { LearnerId } from "./types.js";
import { isoNow, newId } from "./types.js";

const providerCallResult = z.object({
  value: z.unknown(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
      totalTokens: z.number().int().nonnegative(),
    })
    .nullable(),
  resolvedModel: z.string().optional(),
  reasoningSummary: z
    .discriminatedUnion("state", [
      z.object({ state: z.literal("disabled") }),
      z.object({ state: z.literal("unavailable") }),
      z.object({ state: z.literal("available"), text: z.string().min(1).max(10_000) }),
    ])
    .optional(),
  runtime: z
    .object({
      operationId: z.string(),
      attemptId: z.string().nullable(),
      phase: z.string(),
      effect: z.string(),
    })
    .optional(),
});

export const parseProviderCall = (raw: unknown) => providerCallResult.safeParse(raw);

export function recordProviderSuccessEvidence(
  db: Database,
  runId: string,
  result: z.infer<typeof providerCallResult>,
  reasoningSummaryEnabled: boolean,
): void {
  if (result.runtime !== undefined)
    db.run(
      `UPDATE model_run_inspection SET provider_operation_id=?,provider_attempt_id=?,
       effect_state=? WHERE run_id=?`,
      [result.runtime.operationId, result.runtime.attemptId, result.runtime.effect, runId],
    );
  if (reasoningSummaryEnabled && result.reasoningSummary?.state === "available")
    db.run(
      "INSERT INTO model_run_reasoning_summaries(run_id,summary_text,created_at) VALUES(?,?,?)",
      [runId, result.reasoningSummary.text, isoNow()],
    );
}

export function recordProviderFailureEvidence(db: Database, runId: string, error: unknown): void {
  if (!(error instanceof ProviderCallError)) return;
  db.run(
    `UPDATE model_run_inspection SET provider_operation_id=?,provider_attempt_id=?,
     effect_state=? WHERE run_id=?`,
    [error.runtime.operationId, error.runtime.attemptId, error.runtime.effect, runId],
  );
  db.run(
    `UPDATE model_run_details SET output_json=COALESCE(?,output_json),
     usage_json=COALESCE(?,usage_json),model=COALESCE(?,model) WHERE run_id=?`,
    [
      error.rawOutput === undefined ? null : JSON.stringify(error.rawOutput),
      error.usage === null ? null : JSON.stringify(error.usage),
      error.resolvedModel ?? null,
      runId,
    ],
  );
}

export function recordModelTrace(
  db: Database,
  owner: LearnerId,
  runId: string,
  event: string,
  data: Readonly<Record<string, unknown>>,
): void {
  db.run("INSERT INTO traces VALUES(?,?,?,?,?,?)", [
    newId(),
    owner,
    runId,
    event,
    JSON.stringify(data),
    isoNow(),
  ]);
}

export function markModelFallback(
  db: Database,
  owner: LearnerId,
  messageId: string,
  stage: string,
): void {
  db.run(
    `UPDATE model_run_details SET fallback_status='used'
     WHERE run_id=(SELECT id FROM model_runs WHERE learner_id=? AND input_message_id=? AND stage=? AND status='failed' ORDER BY created_at DESC LIMIT 1)`,
    [owner, messageId, stage],
  );
}
