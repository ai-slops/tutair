import type { z } from "zod";
import type { admissionArtifactSchema } from "./tutor-schemas.js";

type KnowledgeArtifact = Extract<
  z.infer<typeof admissionArtifactSchema>,
  { readonly artifactType: "definition" | "claim" | "distinction" }
>;

export function knowledgeArtifactData(artifact: KnowledgeArtifact) {
  switch (artifact.artifactType) {
    case "definition":
      return {
        ...artifact,
        kind: artifact.definitionKind,
        statement: artifact.definition,
        claims: [] as readonly string[],
      };
    case "claim":
      return {
        ...artifact,
        kind: "claim" as const,
        statement: artifact.proposition,
        aliases: [] as readonly string[],
        semanticScope: artifact.evidentialScope,
        distinguishingFeatures: [artifact.predicate, artifact.object],
        claims: [
          {
            text: artifact.proposition,
            authority: "provisional" as const,
            sourceRefs: artifact.sourceRefs,
            status: artifact.provenanceStatus,
          },
        ],
      };
    case "distinction":
      return {
        ...artifact,
        kind: "distinction" as const,
        statement: artifact.contrast,
        aliases: [] as readonly string[],
        semanticScope: artifact.criterion,
        distinguishingFeatures: [artifact.criterion],
        claims: [artifact.contrast],
      };
  }
}
