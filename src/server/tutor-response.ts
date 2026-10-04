import type { z } from "zod";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import { TutorFinalReviewer } from "./tutor-final.js";
import {
  type KnowledgeContext,
  orderedResolutionCandidates,
  persistResolution,
} from "./tutor-knowledge.js";
import { boundModelContext } from "./tutor-model-context.js";
import {
  finalSchema,
  generatedSchema,
  lintedSchema,
  type planningSchema,
  resolutionSchema,
} from "./tutor-schemas.js";
import type { TutorStageRunner } from "./tutor-stage.js";
import { loadTurnKnowledge } from "./tutor-turn-context.js";

type ResponseRequest = {
  readonly common: Readonly<Record<string, unknown>>;
  readonly plan: z.infer<typeof planningSchema>;
  readonly knowledge: readonly KnowledgeContext[];
  readonly allowedKnowledgeIds: readonly string[];
};

export class TutorResponseService {
  constructor(
    readonly knowledge: KnowledgeRepository,
    readonly stages: TutorStageRunner,
  ) {}

  async generate(request: ResponseRequest) {
    const input = this.stages.input;
    const draft = await this.stages.stage({
      stage: "draft",
      schema: generatedSchema,
      data: boundModelContext({
        ...request.common,
        plan: request.plan,
        assistance: input.assistance,
      }),
    });
    const checked = await this.stages.withFallback({
      stage: "lint",
      schema: lintedSchema,
      data: boundModelContext({
        ...request.common,
        draft: draft.value.text,
        plan: request.plan,
        knownStates: request.common["learnerStates"],
      }),
      fallback: {
        safe: true,
        issues: ["lint_skipped"],
        concepts: [],
        generatedCandidates: [],
        lintSkipped: true,
      },
    });
    let changes: readonly unknown[] = [];
    let allowedIds = request.allowedKnowledgeIds;
    if (checked.value.generatedCandidates.length > 0) {
      const candidates = checked.value.generatedCandidates;
      const resolved = await this.stages.stage({
        stage: "resolution",
        schema: resolutionSchema,
        data: boundModelContext({
          ...request.common,
          candidates,
          resolutionCandidates: orderedResolutionCandidates(
            request.knowledge,
            Array.isArray(request.common["relevantHistory"])
              ? request.common["relevantHistory"]
              : [],
            candidates.map((candidate) => candidate.label),
          ),
          independentOfGeneration: true,
        }),
      });
      const persisted = persistResolution({
        repository: this.knowledge,
        owner: input.owner,
        conversationId: input.conversationId,
        messageId: input.messageId,
        runId: resolved.runId,
        resolution: resolved.value,
        candidates,
        offeredKnowledge: request.knowledge,
      });
      changes = persisted.changes;
      allowedIds = [...new Set([...allowedIds, ...persisted.knowledgeIds])];
    }
    const generationContext = loadTurnKnowledge(this.knowledge, input.owner, allowedIds);
    const common = boundModelContext({ ...request.common, ...generationContext });
    const generationKnowledge = generationContext.knowledge;
    const final = await this.stages.stage({
      stage: "final",
      schema: finalSchema,
      data: boundModelContext({
        ...common,
        plan: request.plan,
        draft: draft.value.text,
        lint: checked.value,
        knowledge: generationKnowledge,
        allowedKnowledgeIds: generationKnowledge.map((item) => item.id),
      }),
    });
    const reviewed = await new TutorFinalReviewer(this.stages).review({
      common,
      plan: request.plan,
      initialLint: checked.value,
      final,
      knowledge: generationKnowledge,
    });
    return { ...reviewed, changes, runId: final.runId };
  }
}
