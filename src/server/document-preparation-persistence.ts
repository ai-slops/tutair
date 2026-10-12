import { z } from "zod";
import type { preparationSchema } from "./document-answer-contracts.js";
import type { KnowledgeDocumentRepository } from "./knowledge-document-repository.js";
import type { LearnerId } from "./types.js";
import { ApiError } from "./types.js";

export const misconceptionRiskSchema = z.object({
  misconceptionRevisionId: z.string().uuid(),
  definitionRevisionLinks: z.array(
    z.object({
      definitionRevisionId: z.string().uuid(),
      role: z.string(),
      learningValue: z.string(),
    }),
  ),
});
export type MisconceptionRisk = z.infer<typeof misconceptionRiskSchema>;

type PersistenceInput = {
  readonly documents: KnowledgeDocumentRepository;
  readonly owner: LearnerId;
  readonly runId: string;
  readonly output: z.infer<typeof preparationSchema>;
  readonly missing: readonly string[];
  readonly language: string;
  readonly created: string[];
  readonly misconceptionRisks: readonly MisconceptionRisk[];
};

const misconceptionSourceRefs = (
  definitionRevisionId: string,
  risks: readonly MisconceptionRisk[],
): string[] =>
  risks.flatMap((risk) =>
    risk.definitionRevisionLinks.some((link) => link.definitionRevisionId === definitionRevisionId)
      ? [
          `misconception-revision:${risk.misconceptionRevisionId}`,
          `definition-revision:${definitionRevisionId}`,
        ]
      : [],
  );

export function persistPreparedMaterials(input: PersistenceInput): void {
  const offered = new Set(input.missing);
  for (const material of input.output.materials) {
    if (!offered.has(material.knowledgeRevisionId))
      throw new ApiError(
        422,
        "unoffered_preparation_topic",
        "Preparation returned an unknown revision",
      );
    const existingEnglish = input.documents
      .forRevision(input.owner, material.knowledgeRevisionId)
      .filter((document) => document.role === "english_base" && document.languageTag === "en")
      .toSorted(
        (left, right) =>
          Number(right.owner === null) - Number(left.owner === null) ||
          right.version - left.version,
      )[0];
    const priorDefinition = existingEnglish?.blocks.find((block) => block.type === "definition");
    const nextDefinition = material.englishBlocks.find((block) => block.type === "definition");
    if (
      priorDefinition !== undefined &&
      nextDefinition !== undefined &&
      priorDefinition.content !== nextDefinition.content
    )
      throw new ApiError(
        422,
        "automatic_definition_change",
        "Preparation cannot change an existing concept definition",
      );
    const immutableDefinition = priorDefinition?.content;
    if (
      material.englishBlocks.length > 0 &&
      nextDefinition === undefined &&
      immutableDefinition === undefined
    )
      throw new ApiError(
        422,
        "missing_english_definition",
        "Preparation requires an immutable English definition",
      );
    const englishBlocks =
      material.englishBlocks.length > 0 &&
      nextDefinition === undefined &&
      immutableDefinition !== undefined
        ? [...material.englishBlocks, { type: "definition" as const, content: immutableDefinition }]
        : material.englishBlocks;
    const sourceRefs = misconceptionSourceRefs(
      material.knowledgeRevisionId,
      input.misconceptionRisks,
    );
    const english =
      material.englishBlocks.length === 0
        ? existingEnglish
        : input.documents.create({
            owner: input.owner,
            knowledgeRevisionId: material.knowledgeRevisionId,
            role: "english_base",
            languageTag: "en",
            sourceType: "model_generated",
            modelRunId: input.runId,
            sourceRefs,
            blocks: englishBlocks,
          });
    if (english === undefined)
      throw new ApiError(
        422,
        "missing_english_base",
        "Preparation must create English source material first",
      );
    if (material.englishBlocks.length > 0) input.created.push(english.id);
    if (input.language !== "en" && material.localizedBlocks.length > 0) {
      const localized = input.documents.create({
        owner: input.owner,
        knowledgeRevisionId: material.knowledgeRevisionId,
        role: "localization",
        languageTag: input.language,
        baseDocumentId: english.id,
        sourceType: "model_generated",
        modelRunId: input.runId,
        sourceRefs,
        blocks: material.localizedBlocks.map((block) => {
          const source = english.blocks[block.sourceEnglishIndex];
          if (source === undefined)
            throw new ApiError(
              422,
              "invalid_preparation_source",
              "Localized block source index is unavailable",
            );
          return {
            type: block.type,
            content: block.content,
            sourceBlockId: source.id,
            topicRevisionIds: source.topicRevisionIds,
          };
        }),
      });
      input.created.push(localized.id);
    }
  }
}
