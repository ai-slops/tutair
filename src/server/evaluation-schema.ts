import { z } from "zod";

export const evidenceDimensions = [
  "recognition",
  "recall",
  "explanation",
  "application",
  "discrimination",
  "transfer",
] as const;

export const followupMethods = [
  "ask_explanation",
  "request_example",
  "request_application",
  "request_contrast",
  "request_prediction",
  "inspect_artifact",
  "run_execution",
] as const;

const sourceSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});

const evaluatedEvidenceSchema = z.object({
  knowledgeId: z.string().uuid(),
  knowledgeRevisionId: z.string().uuid(),
  revision: z.number().int().positive(),
  dimension: z.enum(evidenceDimensions),
  evidenceType: z.enum([
    "self_report",
    "recognition_response",
    "free_explanation",
    "application",
    "contrast",
    "prediction",
    "artifact",
    "execution_result",
  ]),
  polarity: z.enum(["positive", "negative", "ambiguous"]),
  score: z.number().min(0).max(1),
  evaluatorConfidence: z.number().min(0).max(1),
  ambiguous: z.boolean(),
  copied: z.boolean(),
  sourceSpans: z.array(sourceSpanSchema).max(32),
  limitations: z.array(z.string().max(1_000)).max(16),
  relatedKnowledgeIds: z.array(z.string().uuid()).max(24),
  assessmentId: z.string().uuid().nullable(),
  threadId: z.string().uuid().nullable(),
  difficulty: z.number().min(0).max(1),
});

export const suggestedFollowupSchema = z
  .object({
    knowledgeUnitId: z.string().uuid(),
    dimension: z.enum(evidenceDimensions),
    method: z.enum(followupMethods),
  })
  .strict();

export const evaluatedSchema = z.object({
  evidence: z.array(evaluatedEvidenceSchema).max(24),
  openQuestion: z.string().max(2_000).nullable(),
  unresolvedAmbiguities: z.array(z.string().min(1).max(1_000)).max(16).default([]),
  suggestedFollowup: suggestedFollowupSchema.nullable().default(null),
});

export type EvaluatedOutput = z.infer<typeof evaluatedSchema>;
