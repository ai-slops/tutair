import { z } from "zod";
import {
  type CompatibleRevisionClaim,
  type DefinitionScope,
  migrateRevisionMetadata,
} from "./knowledge-contracts.js";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import { normalizeResolution, semanticReuseConfidence } from "./resolution-policy.js";
import { applyKnowledgeRisk } from "./tutor-policies.js";
import type { candidateSchema, extractionSchema, resolutionSchema } from "./tutor-schemas.js";
import type { LearnerId } from "./types.js";
import { isoNow, newId } from "./types.js";

const itemSchema = z.object({
  id: z.string().uuid(),
  title: z.string(),
  scope: z.enum(["canonical", "provisional"]),
  current_revision: z.number().int().positive(),
  risk_scope: z.string(),
  kind: z.string(),
  aliases_json: z.string(),
});
const revisionSchema = z.object({
  id: z.string().uuid(),
  knowledge_id: z.string().uuid(),
  revision: z.number().int().positive(),
  statement: z.string(),
  semantic_scope: z.string(),
  definition_scope_json: z.string(),
  distinguishing_features_json: z.string(),
  claims_json: z.string(),
  source_type: z.string(),
  source_message_ids_json: z.string(),
});

export type KnowledgeContext = {
  readonly id: string;
  readonly title: string;
  readonly scope: "canonical" | "provisional";
  readonly revision: number;
  readonly revisionId: string;
  readonly definition: string;
  readonly semanticScope: string;
  readonly definitionScope?: DefinitionScope;
  readonly claimDetails?: readonly CompatibleRevisionClaim[];
  readonly distinguishingFeatures: readonly string[];
  readonly claims: readonly string[];
  readonly riskScope: string;
  readonly kind: string;
  readonly aliases: readonly string[];
};

export function knowledgeContext(
  repository: KnowledgeRepository,
  owner: LearnerId,
  selectedUnitIds: readonly string[],
): readonly KnowledgeContext[] {
  const selected = new Set(repository.eligibleIds(owner, selectedUnitIds));
  return repository
    .list(owner)
    .filter((raw) => selected.has(itemSchema.parse(raw).id))
    .map((raw) => {
      const item = itemSchema.parse(raw);
      const revision = revisionSchema.parse(
        repository.revision(owner, item.id, item.current_revision),
      );
      const metadata = migrateRevisionMetadata(revision);
      return {
        id: item.id,
        title: item.title,
        scope: item.scope,
        revision: revision.revision,
        revisionId: revision.id,
        definition: revision.statement,
        semanticScope: revision.semantic_scope,
        definitionScope: metadata.definitionScope,
        claimDetails: metadata.claims,
        distinguishingFeatures: z
          .array(z.string())
          .parse(JSON.parse(revision.distinguishing_features_json)),
        claims: z
          .array(z.union([z.string(), z.object({ text: z.string() })]))
          .parse(JSON.parse(revision.claims_json))
          .map((claim) => (typeof claim === "string" ? claim : claim.text)),
        riskScope: item.risk_scope,
        kind: item.kind,
        aliases: z.array(z.string()).parse(JSON.parse(item.aliases_json)),
      };
    });
}

export function extractionCandidates(
  extraction: z.infer<typeof extractionSchema>,
): readonly z.infer<typeof candidateSchema>[] {
  return [
    ...extraction.targets,
    ...extraction.prerequisites,
    ...extraction.terms,
    ...extraction.distinctions,
    ...extraction.misconceptions,
    ...extraction.claims,
  ];
}

export function orderedResolutionCandidates(
  knowledge: readonly KnowledgeContext[],
  retrieved: readonly unknown[],
  labels: readonly string[],
): readonly KnowledgeContext[] {
  const normalized = new Set(labels.map((label) => label.toLocaleLowerCase()));
  const retrievedIds = new Set(
    retrieved.flatMap((raw) => {
      const parsed = z.object({ id: z.string() }).safeParse(raw);
      return parsed.success ? [parsed.data.id] : [];
    }),
  );
  const rank = (item: (typeof knowledge)[number]): number =>
    item.scope === "canonical" &&
    [item.title, ...item.aliases].some((label) => normalized.has(label.toLocaleLowerCase()))
      ? 0
      : item.scope === "canonical" && retrievedIds.has(item.id)
        ? 1
        : item.scope === "canonical"
          ? 2
          : 3;
  return knowledge.toSorted(
    (left, right) => rank(left) - rank(right) || left.title.localeCompare(right.title),
  );
}

export function persistResolution(input: {
  readonly repository: KnowledgeRepository;
  readonly owner: LearnerId;
  readonly conversationId: string;
  readonly messageId: string;
  readonly runId: string;
  readonly resolution: z.infer<typeof resolutionSchema>;
  readonly candidates: readonly z.infer<typeof candidateSchema>[];
  readonly offeredKnowledge: readonly KnowledgeContext[];
}): {
  readonly changes: readonly unknown[];
  readonly knowledgeIds: readonly string[];
  readonly resolvedByKey: ReadonlyMap<
    string,
    { readonly knowledgeId: string; readonly revisionId: string }
  >;
} {
  const normalized = normalizeResolution(input);
  const ids = new Set<string>();
  const resolvedByKey = new Map<
    string,
    { readonly knowledgeId: string; readonly revisionId: string }
  >();
  const changes: unknown[] = [];
  const decisions: Record<string, unknown>[] = [];
  for (const decision of normalized.decisions) {
    const raw = decision.candidate;
    switch (decision.resolution) {
      case "reuse": {
        const revision = z
          .object({ id: z.string().uuid() })
          .parse(
            input.repository.revision(
              input.owner,
              decision.knowledge.id,
              decision.knowledge.revision,
            ),
          );
        ids.add(decision.knowledge.id);
        resolvedByKey.set(raw.key, { knowledgeId: decision.knowledge.id, revisionId: revision.id });
        decisions.push({
          key: raw.key,
          resolution: "reuse",
          knowledgeId: decision.knowledge.id,
          revisionId: revision.id,
          reasonCodes: decision.reasonCodes,
        });
        continue;
      }
      case "new":
        break;
      default: {
        const unreachable: never = decision;
        return unreachable;
      }
    }
    const candidate = applyKnowledgeRisk(raw);
    const created = input.repository.createOrReuseGenerated(input.owner, {
      title: candidate.label.slice(0, 200),
      statement: candidate.definition,
      riskScope: candidate.riskScope,
      confidence: candidate.confidence,
      kind: candidate.kind,
      aliases: candidate.aliases,
      semanticScope: candidate.semanticScope,
      ...(candidate.definitionScope === undefined
        ? {}
        : { definitionScope: candidate.definitionScope }),
      distinguishingFeatures: candidate.distinguishingFeatures,
      claims: candidate.claims,
      sourceType: "model_generated",
      sourceRef: input.runId,
      modelRunId: input.runId,
      conversationId: input.conversationId,
      sourceMessageIds: [input.messageId],
    });
    const parsed = z
      .object({
        item: z.object({ id: z.string().uuid() }),
        revision: z.object({ id: z.string().uuid() }),
        created: z.boolean(),
      })
      .parse(created);
    ids.add(parsed.item.id);
    resolvedByKey.set(raw.key, { knowledgeId: parsed.item.id, revisionId: parsed.revision.id });
    if (parsed.created) changes.push(created);
    decisions.push({
      key: raw.key,
      resolution: parsed.created ? "new" : "exact_fingerprint_reuse",
      knowledgeId: parsed.item.id,
      revisionId: parsed.revision.id,
      reasonCodes: decision.reasonCodes,
    });
  }
  input.repository.db.run("INSERT INTO traces VALUES(?,?,?,?,?,?)", [
    newId(),
    input.owner,
    input.runId,
    "knowledge_resolution_applied",
    JSON.stringify({ decisions, ignoredKeys: normalized.ignoredKeys, semanticReuseConfidence }),
    isoNow(),
  ]);
  return { changes, knowledgeIds: [...ids], resolvedByKey };
}
