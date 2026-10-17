import { z } from "zod";
import type { Database } from "./database.js";
import { redactDiagnostic } from "./diagnostic-redaction.js";
import type { LearnerId } from "./types.js";
import { ApiError } from "./types.js";

const requestRow = z.object({
  request_id: z.string(),
  user_message_id: z.string(),
  tutor_message_id: z.string().nullable(),
  state: z.enum(["running", "needs_selection", "completed", "failed"]),
  error_code: z.string().nullable(),
  error_message: z.string().nullable(),
  run_json: z.string().nullable(),
  runtime_operation_id: z.string().nullable(),
  runtime_phase: z.string().nullable(),
  runtime_effect: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
const stageRow = z.object({
  id: z.string(),
  stage: z.string(),
  version: z.string(),
  provider: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  error_code: z.string().nullable(),
  created_at: z.string(),
  model: z.string().nullable(),
  prompt_version: z.string(),
  schema_version: z.string(),
  usage_json: z.string().nullable(),
  latency_ms: z.number().nullable(),
  fallback_status: z.string().nullable(),
  trace_id: z.string().nullable(),
  repair_of_run_id: z.string().nullable(),
  attempt: z.number().nullable(),
  output_mode: z.string().nullable(),
  finished_at: z.string().nullable(),
  context_version: z.string().nullable(),
  context_hash: z.string().nullable(),
  reasoning_summary_enabled: z.number().int().nullable(),
  summary_text: z.string().nullable(),
  runtime_operation_id: z.string().nullable(),
  provider_operation_id: z.string().nullable(),
  provider_attempt_id: z.string().nullable(),
  effect_state: z.string().nullable(),
  cancellation_state: z.string().nullable(),
});
const detailRow = stageRow.extend({
  output_json: z.string().nullable(),
  context_json: z.string().nullable(),
});
const traceRow = z.object({ event: z.string(), data_json: z.string(), created_at: z.string() });

type TurnKey = {
  readonly owner: LearnerId;
  readonly conversationId: string;
  readonly requestId: string;
};

export class GenerationPipelineStore {
  constructor(private readonly db: Database) {}

  summary(key: TurnKey): unknown {
    const request = this.request(key);
    const stages = this.db.all(
      `${stageSelect()} WHERE r.learner_id=? AND r.conversation_id=? AND r.input_message_id=?
       ORDER BY r.created_at,r.id`,
      [key.owner, key.conversationId, request.user_message_id],
      stageRow,
    );
    const flags = parseStoredJson(request.run_json);
    return {
      requestId: request.request_id,
      userMessageId: request.user_message_id,
      tutorMessageId: request.tutor_message_id,
      state: request.state,
      startedAt: request.created_at,
      finishedAt: request.state === "running" ? null : request.updated_at,
      error:
        request.error_code === null || request.error_message === null
          ? null
          : redactDiagnostic({ code: request.error_code, message: request.error_message }),
      flags,
      runtime: {
        operationId: request.runtime_operation_id,
        phase: request.runtime_phase,
        effect: request.runtime_effect,
      },
      stages: stages.map(stageSummary),
    };
  }

  detail(key: TurnKey, runId: string): unknown {
    const request = this.request(key);
    const row = this.db.one(
      `${stageSelect(",d.output_json,c.context_json")}
       WHERE r.id=? AND r.learner_id=? AND r.conversation_id=? AND r.input_message_id=?`,
      [runId, key.owner, key.conversationId, request.user_message_id],
      detailRow,
    );
    if (row === null) throw unavailable();
    const traces = this.db.all(
      `SELECT event,data_json,created_at FROM traces
       WHERE learner_id=? AND run_id=? ORDER BY created_at,id`,
      [key.owner, runId],
      traceRow,
    );
    const recordedCall = parseStoredJson(row.context_json);
    const response = parseStoredJson(row.output_json);
    return {
      ...stageSummary(row),
      recordedCall:
        recordedCall === null
          ? { available: false, reason: "No recorded call exists for this historical run." }
          : {
              available: true,
              contextVersion: row.context_version,
              contextHash: row.context_hash,
              value: redactDiagnostic(recordedCall),
            },
      response:
        response === null
          ? { available: false, validated: false, value: null }
          : {
              available: true,
              validated: row.status === "completed",
              value: redactDiagnostic(response),
            },
      traces: traces.map((trace) => ({
        event: trace.event,
        at: trace.created_at,
        data: redactDiagnostic(parseStoredJson(trace.data_json)),
      })),
      reasoningSummary:
        row.reasoning_summary_enabled !== 1
          ? { state: "disabled" }
          : row.summary_text !== null
            ? { state: "available", text: row.summary_text }
            : row.status === "running"
              ? { state: "pending" }
              : { state: "unavailable" },
    };
  }

  private request(key: TurnKey): z.infer<typeof requestRow> {
    const row = this.db.one(
      `SELECT request_id,user_message_id,tutor_message_id,state,error_code,error_message,
       run_json,runtime_operation_id,runtime_phase,runtime_effect,created_at,updated_at
       FROM tutor_turn_requests
       WHERE learner_id=? AND conversation_id=? AND request_id=?`,
      [key.owner, key.conversationId, key.requestId],
      requestRow,
    );
    if (row === null) throw unavailable();
    return row;
  }
}

function stageSelect(extra = ""): string {
  return `SELECT r.id,r.stage,r.version,r.provider,r.status,r.error_code,r.created_at,
   d.model,d.prompt_version,d.schema_version,d.usage_json,d.latency_ms,d.fallback_status,
    i.trace_id,i.repair_of_run_id,i.attempt,i.output_mode,i.finished_at,i.reasoning_summary_enabled,
    i.runtime_operation_id,i.provider_operation_id,i.provider_attempt_id,i.effect_state,
    i.cancellation_state,
    s.summary_text,
    c.context_version,c.context_hash${extra} FROM model_runs r
   JOIN model_run_details d ON d.run_id=r.id
    LEFT JOIN model_run_inspection i ON i.run_id=r.id
    LEFT JOIN model_run_reasoning_summaries s ON s.run_id=r.id
   LEFT JOIN model_run_contexts c ON c.run_id=r.id`;
}

function stageSummary(row: z.infer<typeof stageRow>) {
  return {
    runId: row.id,
    stage: row.stage,
    status: row.status,
    attempt: row.attempt ?? 1,
    repairOfRunId: row.repair_of_run_id,
    startedAt: row.created_at,
    finishedAt: row.finished_at,
    durationMs: row.latency_ms,
    provider: row.provider,
    model: row.model,
    outputMode: row.output_mode,
    usage: parseStoredJson(row.usage_json),
    errorCode: row.error_code,
    fallbackStatus: row.fallback_status,
    versions: {
      stage: row.version,
      prompt: row.prompt_version,
      schema: row.schema_version,
      context: row.context_version,
    },
    contextHash: row.context_hash,
    runtime: {
      stageOperationId: row.runtime_operation_id,
      providerOperationId: row.provider_operation_id,
      providerAttemptId: row.provider_attempt_id,
      effect: row.effect_state,
      cancellation: row.cancellation_state,
    },
  };
}

function parseStoredJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

function unavailable(): ApiError {
  return new ApiError(404, "generation_pipeline_not_found", "Generation pipeline not found");
}
