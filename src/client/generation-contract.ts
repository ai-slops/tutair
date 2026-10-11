import { z } from "zod";

const UsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export const GenerationStageSchema = z.object({
  runId: z.string(),
  stage: z.enum(["evaluation", "extraction", "resolution", "planning", "draft", "lint", "final"]),
  status: z.enum(["running", "completed", "failed"]),
  attempt: z.number().int().positive(),
  repairOfRunId: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationMs: z.number().int().nonnegative().nullable(),
  provider: z.string(),
  model: z.string().nullable(),
  outputMode: z.string().nullable(),
  usage: UsageSchema.nullable(),
  errorCode: z.string().nullable(),
  fallbackStatus: z.string().nullable(),
  versions: z.object({
    stage: z.string(),
    prompt: z.string(),
    schema: z.string(),
    context: z.string().nullable(),
  }),
  contextHash: z.string().nullable(),
});
export const GenerationPipelineSchema = z.object({
  requestId: z.string(),
  userMessageId: z.string(),
  tutorMessageId: z.string().nullable(),
  state: z.enum(["running", "needs_selection", "completed", "failed"]),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  flags: z.record(z.string(), z.unknown()).nullable(),
  stages: z.array(GenerationStageSchema),
});
const RecordedCallSchema = z.discriminatedUnion("available", [
  z.object({ available: z.literal(false), reason: z.string() }),
  z.object({
    available: z.literal(true),
    contextVersion: z.string().nullable(),
    contextHash: z.string().nullable(),
    value: z.unknown(),
  }),
]);
export const GenerationRunDetailSchema = GenerationStageSchema.extend({
  recordedCall: RecordedCallSchema,
  response: z.object({ available: z.boolean(), validated: z.boolean(), value: z.unknown() }),
  traces: z.array(z.object({ event: z.string(), at: z.string(), data: z.unknown() })),
});

export type GenerationPipeline = z.infer<typeof GenerationPipelineSchema>;
export type GenerationRunDetail = z.infer<typeof GenerationRunDetailSchema>;
export type GenerationStage = z.infer<typeof GenerationStageSchema>;
export type GenerationTarget = {
  readonly conversationId: string;
  readonly requestId: string;
};
