import { z } from "zod";
import type { LearnerId } from "./types.js";
import { riskScopes } from "./types.js";

export const knowledgeKinds = [
  "term_sense",
  "concept",
  "claim",
  "procedure",
  "skill",
  "distinction",
  "misconception",
] as const;
const sourceSpanSchema = z.object({
  start: z.number().int().nonnegative(),
  end: z.number().int().positive(),
});

export const candidateSchema = z.object({
  key: z.string().min(1).max(200),
  label: z.string().min(1).max(200),
  definition: z.string().min(1).max(4_000),
  semanticScope: z.string().max(1_000),
  kind: z.enum(knowledgeKinds),
  aliases: z.array(z.string().max(200)).max(16),
  distinguishingFeatures: z.array(z.string().max(1_000)).max(16),
  claims: z.array(z.string().max(2_000)).max(16),
  riskScope: z.enum(riskScopes),
  confidence: z.number().min(0).max(1),
  sourceSpans: z.array(sourceSpanSchema).max(32),
});

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
    targets: z.array(candidateSchema).max(24),
    prerequisites: z.array(candidateSchema).max(24),
    terms: z.array(candidateSchema).max(24),
    distinctions: z.array(candidateSchema).max(24),
    misconceptions: z.array(candidateSchema).max(24),
    claims: z.array(candidateSchema).max(24),
    relations: z
      .array(
        z.object({
          fromKey: z.string().max(200),
          toKey: z.string().max(200),
          type: z.enum(relationTypes),
          necessity: z.number().min(0).max(1),
          scaffoldable: z.boolean(),
        }),
      )
      .max(48),
  })
  .superRefine((value, context) => {
    const seen = new Map<
      string,
      { readonly definition: string; readonly kind: string; readonly semanticScope: string }
    >();
    const candidates = [
      ...value.targets,
      ...value.prerequisites,
      ...value.terms,
      ...value.distinctions,
      ...value.misconceptions,
      ...value.claims,
    ];
    if (candidates.length > 24)
      context.addIssue({
        code: "custom",
        path: ["candidates"],
        message: "Extraction cannot introduce more than 24 candidates",
      });
    for (const candidate of candidates) {
      const prior = seen.get(candidate.key);
      if (prior === undefined) {
        seen.set(candidate.key, candidate);
        continue;
      }
      if (
        prior.definition !== candidate.definition ||
        prior.kind !== candidate.kind ||
        prior.semanticScope !== candidate.semanticScope
      )
        context.addIssue({
          code: "custom",
          path: ["candidateKey", candidate.key],
          message: "One extraction key cannot identify candidates with different meanings",
        });
    }
  });

export const resolutionSchema = z.object({
  matches: z
    .array(
      z.object({
        candidateKey: z.string().max(200),
        knowledgeId: z.string().uuid(),
        revision: z.number().int().positive(),
        confidence: z.number().min(0).max(1),
        decision: z.enum(["exact", "semantic", "provisional"]),
        reasonCodes: z.array(z.string().max(200)).max(16),
      }),
    )
    .max(24),
  provisional: z
    .array(candidateSchema.extend({ reasonCodes: z.array(z.string().max(200)).max(16) }))
    .max(24),
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

export const evaluatedSchema = z.object({
  evidence: z
    .array(
      z.object({
        knowledgeId: z.string().uuid(),
        knowledgeRevisionId: z.string().uuid(),
        revision: z.number().int().positive(),
        dimension: z.enum([
          "recognition",
          "recall",
          "explanation",
          "application",
          "discrimination",
          "transfer",
        ]),
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
      }),
    )
    .max(24),
  openQuestion: z.string().max(2_000).nullable(),
});

export type TurnInput = {
  readonly owner: LearnerId;
  readonly conversationId: string;
  readonly messageId: string;
  readonly content: string;
  readonly assistance: "none" | "hint" | "worked_example";
  readonly confidence?: number | undefined;
  readonly selfReport: "unsure" | "neutral" | "confident";
};
