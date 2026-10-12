import { z } from "zod";
import { definitionScopeSchema, relationNecessitySchema } from "./knowledge-contracts.js";
import { blockTypes, languageTagSchema } from "./knowledge-document-contracts.js";
import {
  definitionRevisionLinkSchema,
  discriminatingExampleSchema,
} from "./misconception-contracts.js";
import type { threadOrigins } from "./thread-schemas.js";
import type { LearnerId } from "./types.js";
import { riskScopes } from "./types.js";

export { evaluatedSchema } from "./evaluation-schema.js";
export { resolutionSchema } from "./tutor-admission-schema.js";

const sourceSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});

const artifactBase = z.object({
  key: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  riskScope: z.enum(riskScopes),
  confidence: z.number().min(0).max(1),
  sourceSpans: z.array(sourceSpanSchema).max(32),
});

const definitionArtifact = artifactBase
  .extend({
    artifactType: z.literal("definition"),
    definitionKind: z.enum(["concept", "term_sense"]),
    definition: z.string().min(1).max(4_000),
    semanticScope: z.string().max(1_000),
    definitionScope: definitionScopeSchema.optional(),
    aliases: z.array(z.string().max(200)).max(16),
    distinguishingFeatures: z.array(z.string().max(1_000)).max(16),
  })
  .strict();
const claimArtifact = artifactBase
  .extend({
    artifactType: z.literal("claim"),
    proposition: z.string().min(1).max(4_000),
    subjectDefinitionRevisionId: z.string().uuid(),
    predicate: z.string().min(1).max(500),
    object: z.string().min(1).max(2_000),
    evidentialScope: z.string().min(1).max(2_000),
    provenanceStatus: z.enum(["model_generated", "source_supported"]),
    provenanceBasis: z.string().min(1).max(2_000),
    sourceRefs: z.array(z.string().min(1).max(2_000)).max(32),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.provenanceStatus === "model_generated" && value.sourceRefs.length !== 0)
      context.addIssue({
        code: "custom",
        path: ["sourceRefs"],
        message: "Model-generated claims cannot assert source references",
      });
    if (value.provenanceStatus === "source_supported" && value.sourceRefs.length === 0)
      context.addIssue({
        code: "custom",
        path: ["sourceRefs"],
        message: "Source-supported claims require exact offered references",
      });
  });
const distinctionArtifact = artifactBase
  .extend({
    artifactType: z.literal("distinction"),
    definitionRevisionIds: z.tuple([z.string().uuid(), z.string().uuid()]),
    criterion: z.string().min(1).max(2_000),
    contrast: z.string().min(1).max(4_000),
  })
  .strict()
  .refine((value) => value.definitionRevisionIds[0] !== value.definitionRevisionIds[1], {
    message: "A distinction requires two different definition revisions",
    path: ["definitionRevisionIds"],
  });
const materialArtifact = artifactBase
  .extend({
    artifactType: z.literal("material"),
    requestedBlockTypes: z.array(z.enum(blockTypes)).min(1).max(9),
    targetDefinitionRevisionId: z.string().uuid().optional(),
  })
  .strict();
const misconceptionArtifact = artifactBase
  .extend({
    artifactType: z.literal("misconception"),
    mistakenProposition: z.string().min(1).max(4_000),
    correction: z.string().min(1).max(4_000),
    failureTask: z.string().min(1).max(2_000),
    likelyError: z.string().min(1).max(2_000),
    discriminatingExample: discriminatingExampleSchema,
    reuseValueReason: z.string().min(12).max(2_000),
    definitionRevisionLinks: z.array(definitionRevisionLinkSchema).min(1).max(4),
  })
  .strict()
  .superRefine((value, context) => {
    if (!value.definitionRevisionLinks.some((link) => link.role === "subject"))
      context.addIssue({
        code: "custom",
        path: ["definitionRevisionLinks"],
        message: "A subject definition link is required",
      });
  });

export const admissionArtifactSchema = z.discriminatedUnion("artifactType", [
  definitionArtifact,
  claimArtifact,
  distinctionArtifact,
  materialArtifact,
  misconceptionArtifact,
]);
export const candidateSchema = admissionArtifactSchema;

const relationTypes = [
  "prerequisite",
  "subtype",
  "part",
  "entailment",
  "contrast",
  "common_confusion",
  "example",
  "relatedness",
] as const;
export const extractionSchema = z
  .object({
    goal: z.string().min(1).max(2_000),
    sourceLanguage: languageTagSchema,
    responseLanguage: languageTagSchema,
    artifacts: z.array(admissionArtifactSchema).max(24),
    relations: z
      .array(
        z.object({
          fromKey: z.string().max(200),
          toKey: z.string().max(200),
          type: z.enum(relationTypes),
          necessity: relationNecessitySchema,
          scaffoldable: z.boolean(),
        }),
      )
      .max(48),
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const candidate of value.artifacts) {
      if (seen.has(candidate.key))
        context.addIssue({
          code: "custom",
          path: ["candidateKey", candidate.key],
          message: "Extraction candidate keys must be globally unique across all categories",
        });
      else seen.add(candidate.key);
    }
  });

export const planningSchema = z.object({
  move: z.string().min(1).max(1_000),
  currentGoal: z.string().min(1).max(2_000),
  intent: z.enum([
    "answer",
    "teach",
    "diagnose",
    "practice",
    "review",
    "correct",
    "apply",
    "explore",
  ]),
  targetUnits: z.array(z.string().max(200)).max(24),
  assumedUnits: z.array(z.string().max(200)).max(24),
  introducedUnits: z.array(z.string().max(200)).max(24),
  deferredUnits: z.array(z.string().max(200)).max(24),
  deferredQuestions: z.array(z.string().max(2_000)).max(12),
  materialNeeds: z
    .array(
      z.object({
        knowledgeRevisionId: z.string().uuid(),
        blockTypes: z.array(z.enum(blockTypes)).min(1).max(9),
      }),
    )
    .max(24),
  assessmentOpportunities: z
    .array(
      z.object({
        prompt: z.string().max(2_000),
        targetKnowledgeIds: z.array(z.string().uuid()).max(24),
        dimensions: z
          .array(
            z.enum([
              "recognition",
              "recall",
              "explanation",
              "application",
              "discrimination",
              "transfer",
            ]),
          )
          .max(6),
        naturalAfter: z.string().max(1_000),
      }),
    )
    .max(12),
  responseStrategy: z.string().min(1).max(2_000),
  interruptionJustified: z.boolean(),
});

export const generatedSchema = z.object({ text: z.string().min(1).max(20_000) });
export const lintedSchema = z.object({
  safe: z.boolean(),
  issues: z.array(z.string().max(1_000)).max(32),
  concepts: z
    .array(
      z.object({
        concept: z.string().max(500),
        centrality: z.number().min(0).max(1),
        learnerUncertainty: z.number().min(0).max(1),
        misunderstandingCost: z.number().min(0).max(1),
        action: z.enum(["allow", "simplify", "define_inline", "give_example", "diagnose", "defer"]),
        knownKnowledgeId: z.string().uuid().nullable(),
      }),
    )
    .max(32),
  generatedCandidates: z.array(candidateSchema).max(16),
  lintSkipped: z.boolean(),
});
export const finalSchema = generatedSchema.extend({
  exposures: z
    .array(
      z
        .object({
          knowledgeId: z.string().uuid(),
          sourceSpan: sourceSpanSchema.nullish(),
          sourceQuote: z.string().min(1).max(20_000).nullish(),
        })
        .refine((value) => value.sourceSpan != null || value.sourceQuote != null, {
          message: "An exposure requires an exact source quote or source span",
        }),
    )
    .max(24),
});

export type TurnInput = {
  readonly owner: LearnerId;
  readonly conversationId: string;
  readonly messageId: string;
  readonly messageEventId?: string;
  readonly content: string;
  readonly assistance: "none" | "hint" | "worked_example";
  readonly confidence?: number | undefined;
  readonly selfReport: "unsure" | "neutral" | "confident";
  readonly threadId?: string;
  readonly newThread?: boolean;
  readonly origin?: (typeof threadOrigins)[number];
  readonly whyNow?: string;
  readonly desiredOutcome?: string;
};
