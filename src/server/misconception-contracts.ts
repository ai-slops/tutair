import { z } from "zod";

export const misconceptionLinkRoles = ["subject", "contrast", "correction_basis"] as const;
export const misconceptionReviewActions = [
  "reviewed",
  "mark_incorrect",
  "retire",
  "restore",
] as const;

const meaningfulLearningValue = z
  .string()
  .trim()
  .min(12)
  .max(1_000)
  .refine(
    (value) => !/^(?:helpful|useful|relevant|important)(?:\s+for\s+learning)?\.?$/iu.test(value),
    {
      message: "Each link needs a specific learning-value explanation",
    },
  );

export const definitionRevisionLinkSchema = z.object({
  definitionRevisionId: z.string().uuid(),
  role: z.enum(misconceptionLinkRoles),
  learningValue: meaningfulLearningValue,
});

export const discriminatingExampleSchema = z.object({
  scenario: z.string().trim().min(1).max(2_000),
  mistakenResponse: z.string().trim().min(1).max(2_000),
  correctedResponse: z.string().trim().min(1).max(2_000),
  decisiveCue: z.string().trim().min(1).max(2_000),
});

export const misconceptionRevisionInputSchema = z
  .object({
    label: z.string().trim().min(1).max(200),
    mistakenProposition: z.string().trim().min(1).max(4_000),
    correction: z.string().trim().min(1).max(4_000),
    failureTask: z.string().trim().min(1).max(2_000),
    likelyError: z.string().trim().min(1).max(2_000),
    discriminatingExample: discriminatingExampleSchema,
    reuseValueReason: z.string().trim().min(12).max(2_000),
    definitionRevisionLinks: z.array(definitionRevisionLinkSchema).min(1).max(4),
    sourceRefs: z.array(z.string().trim().min(1).max(2_000)).max(32),
    sourceType: z.enum(["learner_manual", "model_generated"]),
    extractionRunId: z.string().uuid().nullable(),
    resolutionRunId: z.string().uuid().nullable(),
    modelReview: z
      .object({
        rubricVersion: z.literal("typed-admission-v1"),
        checks: z.record(z.string(), z.boolean()),
        reasons: z.array(z.string().trim().min(1).max(1_000)).min(1).max(16),
      })
      .nullable(),
  })
  .superRefine((value, context) => {
    const revisionIds = value.definitionRevisionLinks.map((link) => link.definitionRevisionId);
    if (new Set(revisionIds).size !== revisionIds.length)
      context.addIssue({
        code: "custom",
        path: ["definitionRevisionLinks"],
        message: "Definition links must be unique",
      });
    if (!value.definitionRevisionLinks.some((link) => link.role === "subject"))
      context.addIssue({
        code: "custom",
        path: ["definitionRevisionLinks"],
        message: "A subject definition link is required",
      });
    if (value.sourceType === "model_generated" && value.modelReview === null)
      context.addIssue({
        code: "custom",
        path: ["modelReview"],
        message: "Model-generated misconceptions require the admission review",
      });
  });

export const misconceptionReviewSchema = z
  .object({
    action: z.enum(misconceptionReviewActions),
    reason: z.string().trim().min(1).max(2_000).nullable(),
    confirmed: z.boolean(),
  })
  .superRefine((value, context) => {
    if ((value.action === "mark_incorrect" || value.action === "retire") && value.reason === null)
      context.addIssue({ code: "custom", path: ["reason"], message: "A reason is required" });
    if (value.action === "restore" && !value.confirmed)
      context.addIssue({
        code: "custom",
        path: ["confirmed"],
        message: "Restore requires confirmation",
      });
  });

export type MisconceptionRevisionInput = z.infer<typeof misconceptionRevisionInputSchema>;
export type MisconceptionReviewAction = (typeof misconceptionReviewActions)[number];
