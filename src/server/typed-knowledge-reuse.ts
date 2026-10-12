import { z } from "zod";
import type { Database } from "./database.js";
import { admissionArtifactSchema } from "./tutor-schemas.js";

type Artifact = z.infer<typeof admissionArtifactSchema>;
export type KnowledgeArtifact = Extract<
  Artifact,
  { readonly artifactType: "definition" | "claim" | "distinction" }
>;
type RelationalArtifact = Extract<
  KnowledgeArtifact,
  { readonly artifactType: "claim" | "distinction" }
>;

const contractRowSchema = z.object({ contract_json: z.string() });
const normalizedText = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();

export function loadTypedKnowledgeContract(
  database: Database,
  knowledgeRevisionId: string,
): KnowledgeArtifact | null {
  const row = database.one(
    "SELECT contract_json FROM typed_knowledge_contracts WHERE knowledge_revision_id=?",
    [knowledgeRevisionId],
    contractRowSchema,
  );
  if (row === null) return null;
  const parsedRow = admissionArtifactSchema.parse(JSON.parse(row.contract_json));
  switch (parsedRow.artifactType) {
    case "definition":
    case "claim":
    case "distinction":
      return parsedRow;
    case "material":
    case "misconception":
      return null;
  }
}

export function typedRelationalIdentityMatches(
  candidate: RelationalArtifact,
  stored: KnowledgeArtifact | null,
): boolean {
  switch (candidate.artifactType) {
    case "claim":
      return (
        stored?.artifactType === "claim" &&
        candidate.subjectDefinitionRevisionId === stored.subjectDefinitionRevisionId &&
        normalizedText(candidate.proposition) === normalizedText(stored.proposition) &&
        normalizedText(candidate.predicate) === normalizedText(stored.predicate) &&
        normalizedText(candidate.object) === normalizedText(stored.object) &&
        normalizedText(candidate.evidentialScope) === normalizedText(stored.evidentialScope)
      );
    case "distinction":
      return (
        stored?.artifactType === "distinction" &&
        candidate.definitionRevisionIds[0] === stored.definitionRevisionIds[0] &&
        candidate.definitionRevisionIds[1] === stored.definitionRevisionIds[1] &&
        normalizedText(candidate.criterion) === normalizedText(stored.criterion) &&
        normalizedText(candidate.contrast) === normalizedText(stored.contrast)
      );
  }
}
