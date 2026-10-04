import { z } from "zod";

export const LearningThreadSchema = z.object({
  id: z.string(),
  conversationId: z.string().nullable(),
  title: z.string(),
  goal: z.string(),
  origin: z.enum(["question", "project", "problem", "resource", "curriculum", "recommendation"]),
  whyNow: z.string().nullable(),
  desiredOutcome: z.string(),
  status: z.enum(["open", "paused", "resolved", "abandoned"]),
  targetKnowledgeUnitIds: z.array(z.string()),
  deferredKnowledgeUnitIds: z.array(z.string()),
  updatedAt: z.string(),
});
export const LearningThreadsSchema = z.object({ threads: z.array(LearningThreadSchema) });
export const QuestionSchema = z.object({
  id: z.string(),
  question: z.string(),
  status: z.enum(["open", "parked", "resolved"]),
});
export const LearningThreadDetailSchema = z.object({
  thread: LearningThreadSchema,
  openQuestions: z.array(QuestionSchema),
  conversations: z.array(z.object({ id: z.string() })),
});
export const TrackingSchema = z.object({
  evaluationSkipped: z.boolean().default(false),
  extractionFallback: z.boolean().default(false),
  lintSkipped: z.boolean().default(false),
  exposureTrackingSkipped: z.boolean().default(false),
  followupTrackingSkipped: z.boolean().default(false),
});
export const TurnOutcomeSchema = z.object({
  requestId: z.string(),
  userMessageId: z.string(),
  tutorMessageId: z.string().nullable(),
  state: z.enum(["running", "needs_selection", "completed", "failed"]),
  content: z.string(),
  run: TrackingSchema.nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.record(z.string(), z.string()).optional(),
    })
    .nullable(),
});

export function candidateIds(details: Readonly<Record<string, string>>): readonly string[] {
  const value = details["candidateIds"];
  if (value === undefined) return [];
  try {
    return z.array(z.string()).parse(JSON.parse(value));
  } catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) return [];
    throw error;
  }
}
