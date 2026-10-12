import { z } from "zod";
import { preparationSchemaFor } from "./document-answer-contracts.js";
import {
  misconceptionRiskSchema,
  persistPreparedMaterials,
} from "./document-preparation-persistence.js";
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
    const misconceptionRisks = z
      .array(misconceptionRiskSchema)
      .catch([])
      .parse(context["misconceptionRisks"])
      .filter((risk) =>
        risk.definitionRevisionLinks.some((link) => knowledgeIds.has(link.definitionRevisionId)),
      );
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
      const primaryBlockByRevision = new Map(
        knowledge.map((item) => [
          item.revisionId,
          this.documents.primaryBlockType(item.revisionId),
        ]),
      );
      const reusableEnglishPrimaryIds = new Set(
        missing.flatMap((need) =>
          this.documents
            .forRevision(this.stages.input.owner, need.knowledgeRevisionId)
            .some(
              (document) =>
                document.role === "english_base" &&
                document.languageTag === "en" &&
                document.blocks.some(
                  (block) =>
                    block.type ===
                    (primaryBlockByRevision.get(need.knowledgeRevisionId) ?? "definition"),
                ),
            )
            ? [need.knowledgeRevisionId]
            : [],
        ),
      );
      const prepared = await this.stages.stage({
        stage: "preparation",
        schema: preparationSchemaFor(reusableEnglishPrimaryIds, primaryBlockByRevision),
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
        persistPreparedMaterials({
          documents: this.documents,
          owner: this.stages.input.owner,
          runId: prepared.runId,
          output: prepared.value,
          missing: missing.map((need) => need.knowledgeRevisionId),
          language: responseLanguage,
          created,
          misconceptionRisks,
        }),
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
}
