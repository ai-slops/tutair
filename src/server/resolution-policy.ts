import type { z } from "zod";
import { knowledgeScopeFingerprint } from "./knowledge-contracts.js";
import type { KnowledgeContext } from "./tutor-knowledge.js";
import type { candidateSchema, resolutionSchema } from "./tutor-schemas.js";
import { ApiError } from "./types.js";

export const semanticReuseConfidence = 0.9;
type Candidate = z.infer<typeof candidateSchema>;
type Decision = {
  readonly candidate: Candidate;
  readonly reasonCodes: readonly string[];
} & (
  | { readonly resolution: "reuse"; readonly knowledge: KnowledgeContext }
  | { readonly resolution: "attach"; readonly knowledge: KnowledgeContext }
  | { readonly resolution: "new" }
  | { readonly resolution: "skip" }
);

export function normalizeResolution(input: {
  readonly candidates: readonly Candidate[];
  readonly offeredKnowledge: readonly KnowledgeContext[];
  readonly resolution: z.infer<typeof resolutionSchema>;
}): { readonly decisions: readonly Decision[]; readonly ignoredKeys: readonly string[] } {
  const originals = new Map(input.candidates.map((candidate) => [candidate.key, candidate]));
  for (const candidate of input.candidates) {
    if (JSON.stringify(originals.get(candidate.key)) !== JSON.stringify(candidate)) {
      throw new ApiError(
        502,
        "candidate_key_conflict",
        "Extraction reused a key for different meanings",
      );
    }
  }
  const outputKeys = [
    ...input.resolution.matches.map((match) => match.candidateKey),
    ...input.resolution.provisional.map((candidate) => candidate.key),
  ];
  const decisions: Decision[] = [];
  for (const candidate of originals.values()) {
    const matches = input.resolution.matches.filter(
      (match) => match.candidateKey === candidate.key,
    );
    const proposed = input.resolution.provisional.filter((item) => item.key === candidate.key);
    const match = matches[0];
    const offered = input.offeredKnowledge.find(
      (item) => item.id === match?.knowledgeId && item.revision === match.revision,
    );
    const reviewed = proposed[0];
    const attachment = input.offeredKnowledge.find(
      (item) => item.id === reviewed?.knowledgeId && item.revision === reviewed.revision,
    );
    if (
      matches.length === 1 &&
      proposed.length === 0 &&
      match &&
      offered &&
      match.decision !== "provisional" &&
      match.confidence >= semanticReuseConfidence &&
      offered.kind === candidate.kind &&
      knowledgeScopeFingerprint(offered.semanticScope, offered.definitionScope) ===
        knowledgeScopeFingerprint(candidate.semanticScope, candidate.definitionScope)
    ) {
      decisions.push({
        resolution: "reuse",
        candidate,
        knowledge: offered,
        reasonCodes: [...match.reasonCodes, "offered_revision_verified", "scope_compatible"],
      });
    } else if (
      matches.length === 0 &&
      proposed.length === 1 &&
      reviewed?.review === "attach_material" &&
      reviewed.classification === "material_request" &&
      attachment !== undefined
    ) {
      decisions.push({
        resolution: "attach",
        candidate,
        knowledge: attachment,
        reasonCodes: [...reviewed.reasonCodes, "offered_revision_verified"],
      });
    } else if (
      matches.length === 0 &&
      proposed.length === 1 &&
      reviewed?.review === "create" &&
      reviewed.independentlyValidated &&
      candidate.classification === "knowledge_unit"
    ) {
      decisions.push({ resolution: "new", candidate, reasonCodes: reviewed.reasonCodes });
    } else {
      decisions.push({
        resolution: "skip",
        candidate,
        reasonCodes: [
          ...(reviewed?.reasonCodes ?? []),
          matches.length + proposed.length === 0
            ? "omitted_candidate_skipped"
            : matches.length + proposed.length > 1
              ? "conflicting_resolution"
              : match
                ? "equivalence_not_established"
                : reviewed?.review === "ignore"
                  ? "explicitly_ignored"
                  : "creation_not_independently_validated",
        ],
      });
    }
  }
  return {
    decisions,
    ignoredKeys: [...new Set(outputKeys.filter((key) => !originals.has(key)))],
  };
}
