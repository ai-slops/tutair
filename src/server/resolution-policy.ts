import type { z } from "zod";
import { knowledgeScopeFingerprint } from "./knowledge-contracts.js";
import type { KnowledgeContext } from "./tutor-knowledge.js";
import type { admissionArtifactSchema, resolutionSchema } from "./tutor-schemas.js";

export const semanticReuseConfidence = 0.9;
type Artifact = z.infer<typeof admissionArtifactSchema>;
type Admission = z.infer<typeof resolutionSchema>["admissions"][number];
export type ResolutionDecision = {
  readonly artifact: Artifact;
  readonly reasons: readonly string[];
  readonly admission?: Admission;
} & (
  | { readonly resolution: "reuse"; readonly knowledge: KnowledgeContext }
  | { readonly resolution: "attach"; readonly knowledge: KnowledgeContext }
  | { readonly resolution: "new_knowledge" }
  | { readonly resolution: "new_misconception" }
  | { readonly resolution: "skip" }
);

function knowledgeKind(artifact: Artifact): string | null {
  switch (artifact.artifactType) {
    case "definition":
      return artifact.definitionKind;
    case "claim":
      return "claim";
    case "distinction":
      return "distinction";
    case "material":
    case "misconception":
      return null;
  }
}

function referenceSetIsOfferedDefinitions(
  artifact: Artifact,
  offeredByRevision: ReadonlyMap<string, KnowledgeContext>,
): boolean {
  const ids =
    artifact.artifactType === "claim"
      ? [artifact.subjectDefinitionRevisionId]
      : artifact.artifactType === "distinction"
        ? artifact.definitionRevisionIds
        : artifact.artifactType === "misconception"
          ? artifact.definitionRevisionLinks.map((link) => link.definitionRevisionId)
          : [];
  return ids.every((id) => {
    const item = offeredByRevision.get(id);
    return item !== undefined && (item.kind === "concept" || item.kind === "term_sense");
  });
}

function claimSourcesAreOffered(
  artifact: Artifact,
  offeredKnowledge: readonly KnowledgeContext[],
): boolean {
  if (artifact.artifactType !== "claim" || artifact.provenanceStatus === "model_generated")
    return true;
  const offeredSourceRefs = new Set(
    offeredKnowledge.flatMap((item) =>
      (item.claimDetails ?? []).flatMap((claim) =>
        typeof claim === "string" ? [] : claim.sourceRefs,
      ),
    ),
  );
  return artifact.sourceRefs.every((sourceRef) => offeredSourceRefs.has(sourceRef));
}

function compatibleReuse(artifact: Artifact, offered: KnowledgeContext): boolean {
  const expectedKind = knowledgeKind(artifact);
  if (expectedKind === null || offered.kind !== expectedKind) return false;
  if (artifact.artifactType !== "definition") return true;
  return (
    knowledgeScopeFingerprint(offered.semanticScope, offered.definitionScope) ===
    knowledgeScopeFingerprint(artifact.semanticScope, artifact.definitionScope)
  );
}

export function normalizeResolution(input: {
  readonly artifacts: readonly Artifact[];
  readonly offeredKnowledge: readonly KnowledgeContext[];
  readonly resolution: z.infer<typeof resolutionSchema>;
}): { readonly decisions: readonly ResolutionDecision[]; readonly ignoredKeys: readonly string[] } {
  const originals = new Map(input.artifacts.map((artifact) => [artifact.key, artifact]));
  const offeredByRevision = new Map(input.offeredKnowledge.map((item) => [item.revisionId, item]));
  const outputKeys = [
    ...input.resolution.matches.map((match) => match.candidateKey),
    ...input.resolution.admissions.map((admission) => admission.candidateKey),
  ];
  const decisions: ResolutionDecision[] = [];
  for (const artifact of originals.values()) {
    const matches = input.resolution.matches.filter((match) => match.candidateKey === artifact.key);
    const admissions = input.resolution.admissions.filter(
      (admission) => admission.candidateKey === artifact.key,
    );
    const match = matches[0];
    const admission = admissions[0];
    const offered = input.offeredKnowledge.find(
      (item) => item.id === match?.knowledgeId && item.revision === match.revision,
    );
    if (
      matches.length === 1 &&
      admissions.length === 0 &&
      match !== undefined &&
      offered !== undefined &&
      match.decision !== "provisional" &&
      match.confidence >= semanticReuseConfidence &&
      compatibleReuse(artifact, offered)
    ) {
      decisions.push({
        resolution: "reuse",
        artifact,
        knowledge: offered,
        reasons: [...match.reasonCodes, "offered_revision_verified", "typed_contract_compatible"],
      });
      continue;
    }
    if (matches.length !== 0 || admissions.length !== 1 || admission === undefined) {
      decisions.push({
        resolution: "skip",
        artifact,
        reasons: [
          matches.length + admissions.length === 0
            ? "omitted_candidate_skipped"
            : "conflicting_resolution",
        ],
      });
      continue;
    }
    const criteriaPassed = Object.values(admission.checks).every((check) => check);
    if (
      admission.artifactType !== artifact.artifactType ||
      admission.verdict !== "approve" ||
      !criteriaPassed
    ) {
      decisions.push({
        resolution: "skip",
        artifact,
        admission,
        reasons: [
          ...admission.reasons,
          admission.verdict === "reject"
            ? "model_review_rejected"
            : admission.artifactType !== artifact.artifactType
              ? "artifact_type_mismatch"
              : "admission_criteria_failed",
        ],
      });
      continue;
    }
    if (artifact.artifactType === "material" && admission.artifactType === "material") {
      const attachment = input.offeredKnowledge.find(
        (item) => item.id === admission.knowledgeId && item.revision === admission.revision,
      );
      if (attachment === undefined) {
        decisions.push({
          resolution: "skip",
          artifact,
          admission,
          reasons: [...admission.reasons, "unoffered_attachment"],
        });
      } else {
        decisions.push({
          resolution: "attach",
          artifact,
          admission,
          knowledge: attachment,
          reasons: [...admission.reasons, "offered_revision_verified"],
        });
      }
      continue;
    }
    if (!referenceSetIsOfferedDefinitions(artifact, offeredByRevision)) {
      decisions.push({
        resolution: "skip",
        artifact,
        admission,
        reasons: [...admission.reasons, "definition_revision_link_unoffered_or_ineligible"],
      });
      continue;
    }
    if (!claimSourcesAreOffered(artifact, input.offeredKnowledge)) {
      decisions.push({
        resolution: "skip",
        artifact,
        admission,
        reasons: [...admission.reasons, "claim_source_reference_unoffered"],
      });
      continue;
    }
    decisions.push({
      resolution: artifact.artifactType === "misconception" ? "new_misconception" : "new_knowledge",
      artifact,
      admission,
      reasons: admission.reasons,
    });
  }
  return {
    decisions,
    ignoredKeys: [...new Set(outputKeys.filter((key) => !originals.has(key)))],
  };
}
