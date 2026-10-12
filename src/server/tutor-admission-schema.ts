import { z } from "zod";

const reviewBase = {
  candidateKey: z.string().max(200),
  verdict: z.enum(["approve", "reject"]),
  reviewLabel: z.literal("resolution-stage model review"),
  reasons: z.array(z.string().min(1).max(1_000)).min(1).max(16),
} as const;

const admission = <
  const K extends "definition" | "claim" | "distinction" | "misconception" | "material",
  T extends z.ZodRawShape,
>(
  artifactType: K,
  checks: T,
) =>
  z
    .object({
      ...reviewBase,
      artifactType: z.literal(artifactType),
      checks: z.object(checks).strict(),
    })
    .strict();

export const resolutionSchema = z
  .object({
    matches: z
      .array(
        z
          .object({
            candidateKey: z.string().max(200),
            knowledgeId: z.string().uuid(),
            revision: z.number().int().positive(),
            confidence: z.number().min(0).max(1),
            decision: z.enum(["exact", "semantic", "provisional"]),
            reasonCodes: z.array(z.string().max(200)).max(16),
          })
          .strict(),
      )
      .max(24),
    admissions: z
      .array(
        z.discriminatedUnion("artifactType", [
          admission("definition", {
            durableIdentity: z.boolean(),
            boundedMeaning: z.boolean(),
            reusableBeyondCurrentAnswer: z.boolean(),
          }),
          admission("claim", {
            subjectBindingMeaningful: z.boolean(),
            relationExplicit: z.boolean(),
            evidentialScopeHonest: z.boolean(),
            reusable: z.boolean(),
          }),
          admission("distinction", {
            endpointsComparable: z.boolean(),
            criterionDiscriminates: z.boolean(),
            reusable: z.boolean(),
          }),
          admission("misconception", {
            linksMeaningfulForLearning: z.boolean(),
            correctionConsistentWithDefinitions: z.boolean(),
            failureModeConcrete: z.boolean(),
            exampleDiscriminates: z.boolean(),
            reusableBeyondCurrentAnswer: z.boolean(),
            notLearnerBeliefInference: z.boolean(),
          }),
          admission("material", {
            targetBindingExact: z.boolean(),
            answerMaterialOnly: z.boolean(),
          }).extend({
            knowledgeId: z.string().uuid().optional(),
            revision: z.number().int().positive().optional(),
          }),
        ]),
      )
      .max(24),
  })
  .strict();
