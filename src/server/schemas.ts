import { z } from "zod";
import { evidenceEvaluatorSchema } from "./knowledge-contracts.js";
import { evidenceTypes } from "./knowledge-inputs.js";
import { threadOrigins } from "./thread-schemas.js";

export {
  canonicalKnowledgeYamlSchema as canonicalYamlSchema,
  knowledgeCreateBoundarySchema as knowledgeCreateSchema,
} from "./knowledge-contracts.js";
export { resumeSchema, threadCreateSchema, threadUpdateSchema } from "./thread-schemas.js";

export const signupSchema = z
  .object({ displayName: z.string().trim().min(1).max(80).optional() })
  .strict();
export const conversationSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    goal: z.string().trim().max(1000).optional(),
  })
  .strict();
export const messageSchema = z.object({ content: z.string().trim().min(1).max(20_000) }).strict();
export const tutorTurnSchema = messageSchema
  .extend({
    assistance: z.enum(["none", "hint", "worked_example"]).default("none"),
    confidence: z.number().min(0).max(1).optional(),
    selfReport: z.enum(["unsure", "neutral", "confident"]).default("neutral"),
    threadId: z.string().uuid().optional(),
    newThread: z.boolean().optional(),
    origin: z.enum(threadOrigins).optional(),
    whyNow: z.string().trim().min(1).max(2000).optional(),
    desiredOutcome: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
  .refine((value) => !(value.threadId !== undefined && value.newThread === true), {
    message: "Choose an existing thread or a new thread, not both",
  });
export const importSchema = z
  .object({ format: z.literal("yaml"), content: z.string().min(1).max(1_000_000) })
  .strict();
export const evidenceSchema = z
  .object({
    knowledgeId: z.string().uuid(),
    knowledgeRevisionId: z.string().uuid().optional(),
    revision: z.number().int().positive(),
    conversationId: z.string().uuid().optional(),
    messageId: z.string().uuid(),
    messageEventId: z.string().uuid().optional(),
    assessmentId: z.string().uuid().optional(),
    dimension: z
      .enum(["recognition", "recall", "explanation", "application", "discrimination", "transfer"])
      .default("recall"),
    evidenceType: z.enum(evidenceTypes).default("free_explanation"),
    score: z.number().min(0).max(1).optional(),
    polarity: z.enum(["positive", "negative", "ambiguous"]),
    strength: z.number().min(0).max(1).default(0.5),
    evaluatorConfidence: z.number().min(0).max(1).optional(),
    evaluator: evidenceEvaluatorSchema.optional(),
    assistance: z
      .union([
        z.enum(["none", "hint", "worked_example"]),
        z
          .object({
            hints: z.number().int().nonnegative(),
            answerVisible: z.boolean(),
            openBook: z.boolean(),
            copiedFromRecentContext: z.boolean(),
          })
          .strict(),
      ])
      .default("none"),
    confidence: z.number().min(0).max(1).optional(),
    ambiguous: z.boolean().default(false),
    copied: z.boolean().default(false),
    supportingSpans: z
      .array(z.object({ start: z.number().int().nonnegative(), end: z.number().int().positive() }))
      .default([]),
    limitations: z.array(z.string().min(1)).default([]),
    relatedUnitIds: z.array(z.string().uuid()).default([]),
    threadId: z.string().uuid().optional(),
    difficulty: z.number().min(0).max(1).optional(),
    contextDiscount: z.number().min(0).max(1).default(1),
  })
  .strict();
export const rebuildSchema = z.object({ knowledgeId: z.string().uuid().optional() }).strict();
export const correctionSchema = z
  .object({
    knowledgeId: z.string().uuid(),
    revision: z.number().int().positive(),
    statement: z.string().trim().min(1).max(10_000),
    reason: z.string().trim().min(1).max(2000),
    messageId: z.string().uuid().optional(),
    kind: z
      .enum(["revise", "claim_more", "claim_less", "invalidate_evidence", "meaning_mismatch"])
      .default("revise"),
    evidenceIds: z.array(z.string().uuid()).default([]),
    targetType: z.enum(["knowledge", "revision", "evidence", "meaning"]).default("knowledge"),
    targetId: z.string().uuid().optional(),
  })
  .strict();
