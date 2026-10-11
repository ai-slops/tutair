import type { z } from "zod";
import { preparationSchema } from "./document-answer-contracts.js";
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

export class DocumentPreparationService {
  constructor(
    private readonly documents: KnowledgeDocumentRepository,
    private readonly stages: TutorStageRunner,
  ) {}

  async prepare(
    knowledge: readonly KnowledgeContext[],
    responseLanguage: string,
    context: Readonly<Record<string, unknown>>,
  ): Promise<{ readonly blocks: readonly PreparedBlock[]; readonly created: readonly string[] }> {
    if (knowledge.length === 0)
      throw new ApiError(
        422,
        "unresolved_answer_topic",
        "No resolved knowledge revision is available for composition",
      );
    const revisionIds = knowledge.map((item) => item.revisionId);
    const created: string[] = [];
    for (let materialCycle = 0; materialCycle <= 1; materialCycle += 1) {
      const available = this.available(revisionIds, responseLanguage);
      const missing = revisionIds.filter(
        (id) => !available.some((block) => block.topicRevisionIds.includes(id)),
      );
      if (missing.length === 0) return { blocks: available, created };
      const prepared = await this.stages.stage({
        stage: "preparation",
        schema: preparationSchema,
        data: {
          ...context,
          responseLanguage,
          materialCycle,
          missingKnowledgeRevisionIds: missing,
          existingBlocks: available,
          knowledge: knowledge.filter((item) => missing.includes(item.revisionId)),
        },
      });
      this.persist(prepared.runId, prepared.value, missing, responseLanguage, created);
    }
    throw new ApiError(
      422,
      "material_preparation_incomplete",
      "Reusable answer material remained incomplete after one retry",
    );
  }

  private available(revisionIds: readonly string[], language: string): readonly PreparedBlock[] {
    return revisionIds.flatMap((revisionId) => {
      const documents = this.documents.forRevision(revisionId);
      const role = language === "en" ? "english_base" : "localization";
      const matches = documents.filter(
        (document) =>
          document.role === role && document.languageTag === language && !document.stale,
      );
      const latest = matches.toSorted((left, right) => right.version - left.version)[0];
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
        .forRevision(material.knowledgeRevisionId)
        .filter((document) => document.role === "english_base" && document.languageTag === "en")
        .toSorted((left, right) => right.version - left.version)[0];
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
              blocks: material.englishBlocks,
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
            return { type: block.type, content: block.content, sourceBlockId: source.id };
          }),
        });
        created.push(localized.id);
      }
    }
  }
}
