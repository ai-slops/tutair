import { z } from "zod";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import type { KnowledgeContext } from "./tutor-knowledge.js";
import type { admissionArtifactSchema } from "./tutor-schemas.js";
import {
  loadTypedKnowledgeContract,
  typedRelationalIdentityMatches,
} from "./typed-knowledge-reuse.js";
import type { LearnerId } from "./types.js";

type VerificationInput = {
  readonly repository: KnowledgeRepository;
  readonly owner: LearnerId;
  readonly artifact: z.infer<typeof admissionArtifactSchema>;
  readonly knowledge: KnowledgeContext;
  readonly offeredKnowledge: readonly KnowledgeContext[];
};

export function verifiedExplicitReuseRevision(input: VerificationInput): string | null {
  const revision = z
    .object({ id: z.string().uuid() })
    .parse(input.repository.revision(input.owner, input.knowledge.id, input.knowledge.revision));
  const item = z
    .object({ current_revision: z.number().int().positive() })
    .parse(input.repository.item(input.owner, input.knowledge.id));
  if (
    item.current_revision !== input.knowledge.revision ||
    !input.repository.eligibleIds(input.owner, [input.knowledge.id]).includes(input.knowledge.id)
  )
    return null;

  const referenceRevisionIds =
    input.artifact.artifactType === "claim"
      ? [input.artifact.subjectDefinitionRevisionId]
      : input.artifact.artifactType === "distinction"
        ? input.artifact.definitionRevisionIds
        : [];
  const referencesCurrentEligible = referenceRevisionIds.every((revisionId) => {
    const reference = input.offeredKnowledge.find(
      (knowledge) => knowledge.revisionId === revisionId,
    );
    if (
      reference === undefined ||
      (reference.kind !== "concept" && reference.kind !== "term_sense")
    )
      return false;
    const referenceItem = z
      .object({ current_revision: z.number().int().positive() })
      .parse(input.repository.item(input.owner, reference.id));
    return (
      referenceItem.current_revision === reference.revision &&
      input.repository.eligibleIds(input.owner, [reference.id]).includes(reference.id)
    );
  });
  if (!referencesCurrentEligible) return null;
  if (
    (input.artifact.artifactType === "claim" || input.artifact.artifactType === "distinction") &&
    !typedRelationalIdentityMatches(
      input.artifact,
      loadTypedKnowledgeContract(input.repository.db, revision.id),
    )
  )
    return null;
  return revision.id;
}
