import { z } from "zod";
import {
  type CompatibleRevisionClaim,
  type DefinitionScope,
  migrateRevisionMetadata,
} from "./knowledge-contracts.js";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import { type KnowledgeArtifact, loadTypedKnowledgeContract } from "./typed-knowledge-reuse.js";
import type { LearnerId } from "./types.js";

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
  readonly typedContract?: KnowledgeArtifact;
};

export { persistResolution } from "./tutor-knowledge-persistence.js";
export {
  extractionCandidates,
  orderedResolutionCandidates,
  resolutionProbeQueries,
} from "./tutor-resolution-candidates.js";

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
      const typedContract = loadTypedKnowledgeContract(repository.db, revision.id);
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
        ...(typedContract === null ? {} : { typedContract }),
      };
    });
}
