import type { z } from "zod";
import { finalSelectionSchema, renderSelection } from "./answer-composition.js";
import { DocumentPreparationService } from "./document-preparation.js";
import type { KnowledgeDocumentRepository } from "./knowledge-document-repository.js";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import type { KnowledgeContext } from "./tutor-knowledge.js";
import { boundModelContext } from "./tutor-model-context.js";
import { unsafeRiskyFinal } from "./tutor-policies.js";
import { lintedSchema, type planningSchema } from "./tutor-schemas.js";
import type { TutorStageRunner } from "./tutor-stage.js";
import { ApiError } from "./types.js";

type ResponseRequest = {
  readonly common: Readonly<Record<string, unknown>>;
  readonly plan: z.infer<typeof planningSchema>;
  readonly knowledge: readonly KnowledgeContext[];
  readonly responseLanguage: string;
};

export class TutorResponseService {
  constructor(
    readonly knowledge: KnowledgeRepository,
    readonly documents: KnowledgeDocumentRepository,
    readonly stages: TutorStageRunner,
  ) {}

  async generate(request: ResponseRequest) {
    const prepared = await new DocumentPreparationService(this.documents, this.stages).prepare(
      request.knowledge,
      request.responseLanguage,
      request.plan.materialNeeds,
      boundModelContext({ ...request.common, plan: request.plan }),
    );
    const selected = await this.stages.stage({
      stage: "final",
      schema: finalSelectionSchema,
      data: boundModelContext({
        ...request.common,
        plan: request.plan,
        responseLanguage: request.responseLanguage,
        availableBlocks: prepared.blocks.map((block) => ({
          id: block.id,
          type: block.type,
          content: block.content,
          knowledgeRevisionIds: block.topicRevisionIds,
        })),
      }),
    });
    const rendered = renderSelection(selected.value, prepared.blocks);
    const checked = await this.stages.withFallback({
      stage: "lint",
      schema: lintedSchema,
      data: boundModelContext({
        ...request.common,
        knowledge: request.knowledge,
        draft: rendered.text,
        plan: request.plan,
        knownStates: request.common["learnerStates"] ?? [],
        finalReview: true,
      }),
      fallback: {
        safe: false,
        issues: ["lint_skipped"],
        concepts: [],
        generatedCandidates: [],
        lintSkipped: true,
      },
    });
    if (unsafeRiskyFinal(checked.value, request.knowledge))
      throw new ApiError(
        422,
        "unsafe_tutor_output",
        "Unsafe high-stakes or current-contested tutor output was blocked",
      );
    const knowledgeByRevision = new Map(request.knowledge.map((item) => [item.revisionId, item]));
    const exposureByKnowledge = new Map<
      string,
      { knowledgeId: string; sourceSpan: { start: number; end: number }; sourceQuote: null }
    >();
    for (const segment of rendered.segments) {
      for (const revisionId of segment.topicRevisionIds) {
        const item = knowledgeByRevision.get(revisionId);
        if (item !== undefined && !exposureByKnowledge.has(item.id))
          exposureByKnowledge.set(item.id, {
            knowledgeId: item.id,
            sourceSpan: { start: segment.start, end: segment.end },
            sourceQuote: null,
          });
      }
    }
    return {
      final: {
        runId: selected.runId,
        value: { text: rendered.text, exposures: [...exposureByKnowledge.values()] },
        discardedExposures: [],
        rendered,
      },
      knowledge: request.knowledge,
      lintSkipped: checked.value.lintSkipped,
      changes: [],
      createdDocumentIds: prepared.created,
      runId: selected.runId,
    };
  }
}
