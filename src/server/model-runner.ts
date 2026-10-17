import { createHash } from "node:crypto";
import { localContext } from "@slop-lab/part";
import type { Contracts } from "@slop-lab/part/reference/index.js";
import { z } from "zod";
import type { Database } from "./database.js";
import { DebugSettingsStore } from "./debug-settings-store.js";
import {
  MODEL_CONTEXT_VERSION,
  modelContextSnapshot,
  PROMPT_SCHEMA_VERSIONS,
  STAGE_SCHEMA_VERSIONS,
  STAGE_VERSIONS,
} from "./model-context-version.js";
import { modelInstruction } from "./model-instructions.js";
import { modelLanguagePolicy } from "./model-language-policy.js";
import { PartRuntime } from "./part-runtime.js";
import type { Stage, TutorProvider } from "./provider.js";
import { strictOutputSchema } from "./strict-output-schema.js";
import { boundModelContext } from "./tutor-model-context.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

export class StructuredOutputError extends Error {
  constructor(
    readonly runId: string,
    readonly output: unknown,
    readonly issues: z.ZodError["issues"],
  ) {
    super("Model output did not match the required schema");
  }
}

export class ModelRunner {
  constructor(
    readonly db: Database,
    readonly provider: TutorProvider,
    readonly runtime: PartRuntime = new PartRuntime(null),
  ) {}

  async stage<T>(
    owner: LearnerId,
    conversationId: string,
    messageId: string,
    stage: Stage,
    data: Readonly<Record<string, unknown>>,
    schema: z.ZodType<T>,
    parentContext: Contracts.InvocationContext = localContext(),
  ): Promise<{ readonly runId: string; readonly value: T }> {
    let runtimeOperationId = "";
    return this.runtime.stage({
      parent: parentContext,
      kind: `tutair/stage/${stage}`,
      onStarted: (operationId) => {
        runtimeOperationId = operationId;
      },
      body: (stageContext) =>
        this.executeStage(
          owner,
          conversationId,
          messageId,
          stage,
          data,
          schema,
          stageContext,
          runtimeOperationId,
        ),
    });
  }

  private async executeStage<T>(
    owner: LearnerId,
    conversationId: string,
    messageId: string,
    stage: Stage,
    data: Readonly<Record<string, unknown>>,
    schema: z.ZodType<T>,
    stageContext: Contracts.InvocationContext,
    runtimeOperationId: string,
  ): Promise<{ readonly runId: string; readonly value: T }> {
    const runId = newId();
    const started = Date.now();
    const message = data["message"];
    const boundedData = boundModelContext({
      ...data,
      languagePolicy: modelLanguagePolicy(stage),
      ...(stage === "evaluation" && typeof message === "string"
        ? { messageUtf16Length: message.length }
        : {}),
    });
    const inputHash = createHash("sha256").update(JSON.stringify(boundedData)).digest("hex");
    const version = STAGE_VERSIONS[stage];
    const promptVersion =
      this.provider.state.outputMode === "compatibility"
        ? PROMPT_SCHEMA_VERSIONS.compatibilityPrompt
        : PROMPT_SCHEMA_VERSIONS.prompt;
    const schemaVersion = STAGE_SCHEMA_VERSIONS[stage];
    const traceId = typeof data["traceId"] === "string" ? data["traceId"] : null;
    const repairOfRunId = typeof data["repairOfRunId"] === "string" ? data["repairOfRunId"] : null;
    const reasoningSummaryEnabled = new DebugSettingsStore(this.db).get(
      owner,
    ).saveProviderReasoningSummaries;
    this.db.run("INSERT INTO model_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)", [
      runId,
      owner,
      conversationId,
      stage,
      version,
      this.provider.state.provider,
      "running",
      messageId,
      null,
      null,
      isoNow(),
    ]);
    this.db.run("INSERT INTO model_run_details VALUES(?,?,?,?,?,?,?,?,?,?)", [
      runId,
      this.provider.state.model,
      stage,
      promptVersion,
      schemaVersion,
      inputHash,
      null,
      null,
      null,
      null,
    ]);
    this.db.run(
      "INSERT INTO model_run_inspection(run_id,trace_id,repair_of_run_id,attempt,output_mode,finished_at,reasoning_summary_enabled) VALUES(?,?,?,?,?,?,?)",
      [
        runId,
        traceId,
        repairOfRunId,
        repairOfRunId === null ? 1 : 2,
        this.provider.state.outputMode ?? null,
        null,
        reasoningSummaryEnabled ? 1 : 0,
      ],
    );
    this.db.run(
      "UPDATE model_run_inspection SET runtime_operation_id=?,effect_state='not-attempted' WHERE run_id=?",
      [runtimeOperationId, runId],
    );
    try {
      const jsonSchema = z
        .record(z.string(), z.unknown())
        .parse(strictOutputSchema(z.toJSONSchema(schema)));
      const call = {
        stage,
        version,
        system: modelInstruction(stage),
        data: boundedData,
        jsonSchema,
        reasoningSummaryEnabled,
      } satisfies Parameters<TutorProvider["call"]>[0];
      const snapshot = modelContextSnapshot(call);
      this.db.run("INSERT INTO model_run_contexts VALUES(?,?,?,?,?,?)", [
        runId,
        owner,
        MODEL_CONTEXT_VERSION,
        snapshot.json,
        snapshot.hash,
        isoNow(),
      ]);
      const raw = await this.provider.call(call, owner, stageContext);
      const result = z
        .object({
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
              effect: z.string(),
            })
            .optional(),
        })
        .safeParse(raw);
      const output = result.success ? result.data.value : raw;
      const reasoningSummary = result.success ? result.data.reasoningSummary : undefined;
      if (result.success && result.data.runtime !== undefined)
        this.db.run(
          `UPDATE model_run_inspection SET provider_operation_id=?,provider_attempt_id=?,
           effect_state=? WHERE run_id=?`,
          [
            result.data.runtime.operationId,
            result.data.runtime.attemptId,
            result.data.runtime.effect,
            runId,
          ],
        );
      if (reasoningSummaryEnabled && reasoningSummary?.state === "available")
        this.db.run(
          "INSERT INTO model_run_reasoning_summaries(run_id,summary_text,created_at) VALUES(?,?,?)",
          [runId, reasoningSummary.text, isoNow()],
        );
      const parsed = schema.safeParse(output);
      if (!parsed.success) {
        this.db.run(
          `UPDATE model_run_details SET output_json=?,usage_json=?,model=COALESCE(?,model)
           WHERE run_id=?`,
          [
            JSON.stringify(output),
            !result.success || result.data.usage === null
              ? null
              : JSON.stringify(result.data.usage),
            result.success ? (result.data.resolvedModel ?? null) : null,
            runId,
          ],
        );
        throw new StructuredOutputError(runId, output, parsed.error.issues);
      }
      const value = parsed.data;
      this.db.run("UPDATE model_runs SET status='completed' WHERE id=? AND learner_id=?", [
        runId,
        owner,
      ]);
      this.db.run(
        `UPDATE model_run_details SET output_json=?,usage_json=?,latency_ms=?,fallback_status=?,
         model=COALESCE(?,model) WHERE run_id=?`,
        [
          JSON.stringify(value),
          !result.success || result.data.usage === null ? null : JSON.stringify(result.data.usage),
          Date.now() - started,
          "none",
          result.success ? (result.data.resolvedModel ?? null) : null,
          runId,
        ],
      );
      this.db.run("UPDATE model_run_inspection SET finished_at=? WHERE run_id=?", [
        isoNow(),
        runId,
      ]);
      this.db.run(
        "UPDATE model_run_inspection SET effect_state=COALESCE(effect_state,'unknown') WHERE run_id=?",
        [runId],
      );
      this.trace(owner, runId, "stage_completed", {
        stage,
        traceId: data["traceId"] ?? null,
        messageId,
        conversationId,
        inputHash,
        usage: result.success ? result.data.usage : null,
        repairOfRunId: data["repairOfRunId"] ?? null,
      });
      return { runId, value };
    } catch (error) {
      const code =
        error instanceof ApiError
          ? error.code
          : error instanceof z.ZodError || error instanceof StructuredOutputError
            ? "structured_output_invalid"
            : "provider_failed";
      this.db.run(
        "UPDATE model_runs SET status='failed',error_code=? WHERE id=? AND learner_id=?",
        [code, runId, owner],
      );
      this.db.run("UPDATE model_run_details SET latency_ms=?,fallback_status=? WHERE run_id=?", [
        Date.now() - started,
        "failed",
        runId,
      ]);
      this.db.run("UPDATE model_run_inspection SET finished_at=? WHERE run_id=?", [
        isoNow(),
        runId,
      ]);
      this.db.run(
        "UPDATE model_run_inspection SET effect_state=COALESCE(effect_state,'unknown') WHERE run_id=?",
        [runId],
      );
      this.trace(owner, runId, "stage_failed", {
        stage,
        code,
        traceId: data["traceId"] ?? null,
        messageId,
        conversationId,
        inputHash,
      });
      throw error;
    }
  }

  markFallback(owner: LearnerId, messageId: string, stage: Stage): void {
    this.db.run(
      `UPDATE model_run_details SET fallback_status='used'
       WHERE run_id=(SELECT id FROM model_runs WHERE learner_id=? AND input_message_id=? AND stage=? AND status='failed' ORDER BY created_at DESC LIMIT 1)`,
      [owner, messageId, stage],
    );
  }

  private trace(
    owner: LearnerId,
    runId: string,
    event: string,
    data: Readonly<Record<string, unknown>>,
  ): void {
    this.db.run("INSERT INTO traces VALUES(?,?,?,?,?,?)", [
      newId(),
      owner,
      runId,
      event,
      JSON.stringify(data),
      isoNow(),
    ]);
  }
}
