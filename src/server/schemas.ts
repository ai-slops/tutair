import { z } from "zod";
import { evidenceTypes } from "./knowledge-inputs.js";
import { riskScopes } from "./types.js";

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
  })
  .strict();
export const threadCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    goal: z.string().trim().min(1).max(1000),
    conversationId: z.string().uuid().optional(),
  })
  .strict();
export const threadUpdateSchema = z
  .object({
    title: z.string().trim().min(1).max(160).optional(),
    goal: z.string().trim().min(1).max(1000).optional(),
    status: z.enum(["open", "paused", "resolved"]).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0);
export const resumeSchema = z.object({ conversationId: z.string().uuid().optional() }).strict();
export const knowledgeCreateSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    statement: z.string().trim().min(1).max(10_000),
    scope: z.literal("provisional").default("provisional"),
    riskScope: z.enum(riskScopes).default("stable"),
    confidence: z.number().min(0).max(1).default(0.5),
    kind: z
      .enum([
        "term_sense",
        "concept",
        "claim",
        "procedure",
        "skill",
        "distinction",
        "misconception",
      ])
      .default("claim"),
    aliases: z.array(z.string().trim().min(1)).default([]),
    semanticScope: z.string().default(""),
    distinguishingFeatures: z.array(z.string()).default([]),
    claims: z.array(z.string()).default([]),
  })
  .strict();
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
    evaluator: z
      .object({
        type: z.enum(["model", "human", "rule"]),
        modelRunId: z.string().uuid().nullable().optional(),
        rubricVersion: z.string().min(1),
      })
      .strict()
      .optional(),
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
export const canonicalYamlSchema = z
  .object({
    source: z.string().trim().min(1),
    generated: z.literal(false).optional(),
    items: z
      .array(
        z
          .object({
            key: z.string().trim().min(1),
            title: z.string().trim().min(1),
            statement: z.string().trim().min(1),
            kind: z
              .enum([
                "term_sense",
                "concept",
                "claim",
                "procedure",
                "skill",
                "distinction",
                "misconception",
              ])
              .default("claim"),
            aliases: z.array(z.string()).default([]),
            semanticScope: z.string().default(""),
            distinguishingFeatures: z.array(z.string()).default([]),
            claims: z.array(z.string()).default([]),
            riskScope: z.enum(riskScopes).default("stable"),
            relations: z
              .array(
                z
                  .object({
                    to: z.string(),
                    kind: z.enum([
                      "prerequisite",
                      "subtype",
                      "part",
                      "entailment",
                      "contrast",
                      "common_confusion",
                      "example",
                      "relatedness",
                    ]),
                    necessity: z.enum(["required", "helpful", "optional"]).optional(),
                    scaffoldable: z.boolean().optional(),
                  })
                  .strict(),
              )
              .default([]),
          })
          .strict(),
      )
      .min(1),
  })
  .strict();
