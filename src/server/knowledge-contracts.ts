import { z } from "zod";
import { riskScopes } from "./types.js";

export const claimStatuses = ["model_generated", "source_supported", "reviewed"] as const;
export const claimStatusSchema = z.enum(claimStatuses);

export const definitionScopeSchema = z
  .object({
    domain: z.string().trim().min(1).max(500).optional(),
    context: z.string().trim().min(1).max(2_000).optional(),
    audienceLevel: z.string().trim().min(1).max(200).optional(),
    inclusions: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
    exclusions: z.array(z.string().trim().min(1).max(500)).max(100).optional(),
  })
  .strict();
export type DefinitionScope = z.infer<typeof definitionScopeSchema>;

export const revisionClaimSchema = z
  .object({
    text: z.string().trim().min(1).max(10_000),
    authority: z.enum(["canonical", "provisional", "learner", "external"]),
    sourceRefs: z.array(z.string().trim().min(1).max(2_000)),
    status: claimStatusSchema.optional(),
  })
  .strict();
export const compatibleRevisionClaimSchema = z.union([z.string(), revisionClaimSchema]);
export type CompatibleRevisionClaim = z.infer<typeof compatibleRevisionClaimSchema>;

export const relationNecessitySchema = z.union([
  z.enum(["hard", "soft", "contextual", "recommended", "required", "helpful", "optional"]),
  z.number().min(0).max(1),
]);
export type RelationNecessity = z.infer<typeof relationNecessitySchema>;

export const evidenceEvaluatorSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("model"),
      modelRunId: z.string().uuid().nullable().optional(),
      rubricVersion: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.enum(["human", "rule"]),
      modelRunId: z.string().uuid().nullable().optional(),
      rubricVersion: z.string().trim().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("test_runner"),
      rubricVersion: z.string().trim().min(1),
      runner: z.string().trim().min(1).max(200),
      suiteRef: z.string().trim().min(1).max(2_000),
      resultRef: z.string().trim().min(1).max(2_000).optional(),
    })
    .strict(),
]);
export type EvidenceEvaluator = z.infer<typeof evidenceEvaluatorSchema>;

const knowledgeKinds = [
  "term_sense",
  "concept",
  "claim",
  "procedure",
  "skill",
  "distinction",
  "misconception",
] as const;

const knowledgeFields = {
  title: z.string().trim().min(1).max(200),
  statement: z.string().trim().min(1).max(10_000),
  riskScope: z.enum(riskScopes).default("stable"),
  confidence: z.number().min(0).max(1).default(0.5),
  kind: z.enum(knowledgeKinds).default("claim"),
  aliases: z.array(z.string().trim().min(1)).default([]),
  semanticScope: z.string().max(2_000).default(""),
  definitionScope: definitionScopeSchema.default({}),
  distinguishingFeatures: z.array(z.string()).default([]),
  claims: z.array(compatibleRevisionClaimSchema).default([]),
} as const;

export const knowledgeCreateBoundarySchema = z
  .object({ scope: z.literal("provisional").default("provisional"), ...knowledgeFields })
  .strict();

export const canonicalKnowledgeYamlSchema = z
  .object({
    source: z.string().trim().min(1),
    generated: z.literal(false).optional(),
    items: z
      .array(
        z
          .object({
            key: z.string().trim().min(1),
            ...knowledgeFields,
            relations: z
              .array(
                z
                  .object({
                    to: z.string().trim().min(1),
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
                    necessity: relationNecessitySchema.optional(),
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

export const knowledgeMetadataDefaults = {
  definitionScope: {},
  modelClaimStatus: "model_generated",
} as const;

const normalizedScopeText = (text: string): string =>
  text.normalize("NFKC").trim().toLocaleLowerCase();

export const knowledgeScopeFingerprint = (
  semanticScope: string,
  definitionScope: DefinitionScope | undefined,
): string =>
  JSON.stringify({
    semanticScope: normalizedScopeText(semanticScope),
    domain: normalizedScopeText(definitionScope?.domain ?? ""),
    context: normalizedScopeText(definitionScope?.context ?? ""),
    audienceLevel: normalizedScopeText(definitionScope?.audienceLevel ?? ""),
    inclusions: (definitionScope?.inclusions ?? []).map(normalizedScopeText).toSorted(),
    exclusions: (definitionScope?.exclusions ?? []).map(normalizedScopeText).toSorted(),
  });

export class ClaimPromotionError extends Error {
  constructor() {
    super("Model-generated claims cannot self-promote");
    this.name = "ClaimPromotionError";
  }
}

export const normalizeRevisionClaims = (
  claims: readonly (
    | string
    | {
        readonly text: string;
        readonly authority: "canonical" | "provisional" | "learner" | "external";
        readonly sourceRefs: readonly string[];
        readonly status?: "model_generated" | "source_supported" | "reviewed" | undefined;
      }
  )[],
  sourceType: string,
): readonly CompatibleRevisionClaim[] =>
  claims.map((claim) => {
    if (typeof claim === "string") return claim;
    const parsed = revisionClaimSchema.parse(claim);
    if (
      sourceType === "model_generated" &&
      parsed.status !== undefined &&
      parsed.status !== "model_generated"
    ) {
      throw new ClaimPromotionError();
    }
    if (parsed.status !== undefined || sourceType !== "model_generated") return parsed;
    return { ...parsed, status: "model_generated" };
  });

const revisionMetadataRowSchema = z.object({
  semantic_scope: z.string().default(""),
  definition_scope_json: z.string().optional(),
  claims_json: z.string(),
});

export const migrateRevisionMetadata = (raw: unknown) => {
  const row = revisionMetadataRowSchema.parse(raw);
  const definitionScope = definitionScopeSchema.parse(
    row.definition_scope_json === undefined ? {} : JSON.parse(row.definition_scope_json),
  );
  const claims = z.array(compatibleRevisionClaimSchema).parse(JSON.parse(row.claims_json));
  return { semanticScope: row.semantic_scope, definitionScope, claims } as const;
};
