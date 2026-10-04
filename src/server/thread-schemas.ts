import { z } from "zod";

export const threadOrigins = [
  "question",
  "project",
  "problem",
  "resource",
  "curriculum",
  "recommendation",
] as const;

export const threadStatusSchema = z
  .enum(["open", "paused", "resolved", "abandoned", "active", "parked"])
  .transform((status) => {
    if (status === "active") return "open" as const;
    if (status === "parked") return "paused" as const;
    return status;
  });

const knowledgeUnitIds = z.array(z.string().uuid()).max(500);

export const threadCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    goal: z.string().trim().min(1).max(1000).optional(),
    origin: z.enum(threadOrigins).default("question"),
    whyNow: z.string().trim().min(1).max(2000).nullable().optional(),
    desiredOutcome: z.string().trim().min(1).max(2000).optional(),
    targetKnowledgeUnitIds: knowledgeUnitIds.default([]),
    deferredKnowledgeUnitIds: knowledgeUnitIds.default([]),
    conversationId: z.string().uuid().optional(),
  })
  .strict()
  .refine((input) => input.goal !== undefined || input.desiredOutcome !== undefined, {
    message: "A current goal or desired outcome is required",
  });

export const threadUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    goal: z.string().trim().min(1).max(1000).optional(),
    origin: z.enum(threadOrigins).optional(),
    whyNow: z.string().trim().min(1).max(2000).nullable().optional(),
    desiredOutcome: z.string().trim().min(1).max(2000).optional(),
    targetKnowledgeUnitIds: knowledgeUnitIds.optional(),
    deferredKnowledgeUnitIds: knowledgeUnitIds.optional(),
    status: threadStatusSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);

export const resumeSchema = z.object({ conversationId: z.string().uuid().optional() }).strict();
export const threadQuestionCreateSchema = z
  .object({ text: z.string().trim().min(1).max(2000) })
  .strict();
export const threadQuestionUpdateSchema = z
  .object({ status: z.enum(["open", "resolved", "parked"]) })
  .strict();

export const threadRecord = z.object({
  id: z.string(),
  learner_id: z.string(),
  conversation_id: z.string().nullable(),
  title: z.string(),
  goal: z.string(),
  origin: z.enum(threadOrigins),
  why_now: z.string().nullable(),
  desired_outcome: z.string(),
  target_knowledge_unit_ids_json: z.string(),
  deferred_knowledge_unit_ids_json: z.string(),
  status: z.enum(["open", "paused", "resolved", "abandoned"]),
  created_at: z.string(),
  updated_at: z.string(),
});

export const threadQuestionRecord = z.object({
  id: z.string(),
  thread_id: z.string(),
  learner_id: z.string(),
  question: z.string(),
  status: z.enum(["open", "resolved", "parked"]),
  created_at: z.string(),
});

export type ThreadRecord = z.infer<typeof threadRecord>;
export type ThreadQuestionRecord = z.infer<typeof threadQuestionRecord>;
export type ThreadCreate = z.input<typeof threadCreateSchema>;
export type ThreadUpdate = z.infer<typeof threadUpdateSchema>;
