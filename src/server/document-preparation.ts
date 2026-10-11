import type { z } from "zod";
import { type preparationSchema, preparationSchemaFor } from "./document-answer-contracts.js";
import type { blockTypes } from "./knowledge-document-contracts.js";
import type { KnowledgeDocumentRepository } from "./knowledge-document-repository.js";
import type { KnowledgeContext } from "./tutor-knowledge.js";
import type { TutorStageRunner } from "./tutor-stage.js";
import { ApiError } from "./types.js";

export type PreparedBlock = {
  readonly id: string;
  readonly content: string;
  readonly contentHash: string;
  readonly type: string;
  readonly languageTag: string;
  readonly documentId: string;
  readonly topicRevisionIds: readonly string[];
};
type MaterialNeed = {
  readonly knowledgeRevisionId: string;
  readonly blockTypes: readonly (typeof blockTypes)[number][];
};

export class DocumentPreparationService {
  constructor(
    private readonly documents: KnowledgeDocumentRepository,
    private readonly stages: TutorStageRunner,
  ) {}

  async prepare(
    knowledge: readonly KnowledgeContext[],
    responseLanguage: string,
    materialNeeds: readonly MaterialNeed[],
    context: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly blocks: readonly PreparedBlock[]; readonly created: readonly string[] }> {
    if (knowledge.length === 0)
      throw new ApiError(
        422,
        "unresolved_answer_topic",
        "No resolved knowledge revision is available for composition",
      );
    const knowledgeIds = new Set(knowledge.map((item) => item.revisionId));
    const needs = materialNeeds.filter((need) => knowledgeIds.has(need.knowledgeRevisionId));
    if (needs.length === 0)
      throw new ApiError(422, "missing_material_plan", "Planning selected no answer material");
    const created: string[] = [];
    for (let materialCycle = 0; materialCycle <= 1; materialCycle += 1) {
      const available = this.available(needs, responseLanguage);
      const missing = needs.filter(
        (need) =>
          !need.blockTypes.every((type) =>
            available.some(
              (block) =>
                block.type === type && block.topicRevisionIds.includes(need.knowledgeRevisionId),
            ),
          ),
      );
      if (missing.length === 0) return { blocks: available, created };
      const reusableEnglishDefinitionIds = new Set(
        missing.flatMap((need) =>
          this.documents
            .forRevision(this.stages.input.owner, need.knowledgeRevisionId)
            .some(
              (document) =>
                document.role === "english_base" &&
                document.languageTag === "en" &&
                document.blocks.some((block) => block.type === "definition"),
            )
            ? [need.knowledgeRevisionId]
            : [],
        ),
      );
      const prepared = await this.stages.stage({
        stage: "preparation",
        schema: preparationSchemaFor(reusableEnglishDefinitionIds),
        data: {
          ...context,
          responseLanguage,
          materialCycle,
          materialNeeds: missing,
          missingKnowledgeRevisionIds: missing.map((need) => need.knowledgeRevisionId),
          existingBlocks: available,
          knowledge: knowledge.filter((item) =>
            missing.some((need) => need.knowledgeRevisionId === item.revisionId),
          ),
        },
      });
      this.documents.transaction(() =>
        this.persist(
          prepared.runId,
          prepared.value,
          missing.map((need) => need.knowledgeRevisionId),
          responseLanguage,
          created,
        ),
      );
    }
    throw new ApiError(
      422,
      "material_preparation_incomplete",
      "Reusable answer material remained incomplete after one retry",
    );
  }

  private available(needs: readonly MaterialNeed[], language: string): readonly PreparedBlock[] {
    return needs.flatMap((need) => {
      const documents = this.documents.forRevision(
        this.stages.input.owner,
        need.knowledgeRevisionId,
      );
      const role = language === "en" ? "english_base" : "localization";
      const matches = documents.filter(
        (document) =>
          document.role === role && document.languageTag === language && !document.stale,
      );
      const latest = matches
        .filter((document) =>
          need.blockTypes.every((type) => document.blocks.some((block) => block.type === type)),
        )
        .toSorted(
          (left, right) =>
            Number(right.owner === null) - Number(left.owner === null) ||
            right.version - left.version,
        )[0];
      return latest === undefined
        ? []
        : latest.blocks.map((block) => ({
            ...block,
            languageTag: latest.languageTag,
            documentId: latest.id,
          }));
    });
  }

  private persist(
    runId: string,
    output: z.infer<typeof preparationSchema>,
    missing: readonly string[],
    language: string,
    created: string[],
  ): void {
    const offered = new Set(missing);
    for (const material of output.materials) {
      if (!offered.has(material.knowledgeRevisionId))
        throw new ApiError(
          422,
          "unoffered_preparation_topic",
          "Preparation returned an unknown revision",
        );
      const existingEnglish = this.documents
        .forRevision(this.stages.input.owner, material.knowledgeRevisionId)
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
          ? [
              ...material.englishBlocks,
              { type: "definition" as const, content: immutableDefinition },
            ]
          : material.englishBlocks;
      const english =
        material.englishBlocks.length === 0
          ? existingEnglish
          : this.documents.create({
              owner: this.stages.input.owner,
              knowledgeRevisionId: material.knowledgeRevisionId,
              role: "english_base",
              languageTag: "en",
              sourceType: "model_generated",
              modelRunId: runId,
              sourceRefs: [],
              blocks: englishBlocks,
            });
      if (english === undefined)
        throw new ApiError(
          422,
          "missing_english_base",
          "Preparation must create English source material first",
        );
      if (material.englishBlocks.length > 0) created.push(english.id);
      if (language !== "en" && material.localizedBlocks.length > 0) {
        const localized = this.documents.create({
          owner: this.stages.input.owner,
          knowledgeRevisionId: material.knowledgeRevisionId,
          role: "localization",
          languageTag: language,
          baseDocumentId: english.id,
          sourceType: "model_generated",
          modelRunId: runId,
          sourceRefs: [],
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
        created.push(localized.id);
      }
    }
  }
}
