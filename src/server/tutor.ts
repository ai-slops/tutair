import type { Database } from "./database.js";
import { ModelRunner } from "./model-runner.js";
import type { TutorProvider } from "./provider.js";
import type { CoreRepository } from "./repository-core.js";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import { searchKnowledge } from "./search.js";
import { loadTutorContext } from "./tutor-context.js";
import { TutorFinalReviewer } from "./tutor-final.js";
import {
  extractionCandidates,
  knowledgeContext,
  orderedResolutionCandidates,
  persistResolution,
} from "./tutor-knowledge.js";
import { boundModelContext } from "./tutor-model-context.js";
import { copiedFromTutor, enforceCopiedDiscount } from "./tutor-policies.js";
import {
  evaluatedSchema,
  extractionSchema,
  finalSchema,
  generatedSchema,
  lintedSchema,
  planningSchema,
  resolutionSchema,
  type TurnInput,
} from "./tutor-schemas.js";
import { TutorStageRunner } from "./tutor-stage.js";
import { TutorTurnStore } from "./tutor-turn-store.js";
import { newId } from "./types.js";

export class TutorPipeline {
  readonly runner: ModelRunner;
  constructor(
    readonly db: Database,
    readonly core: CoreRepository,
    readonly knowledge: KnowledgeRepository,
    readonly provider: TutorProvider,
  ) {
    this.runner = new ModelRunner(db, provider);
  }

  async turn(input: TurnInput): Promise<{
    readonly tutorMessage: unknown;
    readonly run: unknown;
    readonly thread: unknown;
    readonly knowledgeChanges: readonly unknown[];
  }> {
    const traceId = newId();
    const stages = new TutorStageRunner(this.runner, input);
    const store = new TutorTurnStore(this.db, this.core, this.knowledge);
    const retrieval = await searchKnowledge(this.db, this.provider, input.owner, input.content, 16);
    const context = loadTutorContext(this.db, this.core, input, retrieval.results);
    const immutableKnowledge = knowledgeContext(
      this.knowledge,
      input.owner,
      context.selectedKnowledgeIds,
    );
    const rawCommon = {
      traceId,
      message: input.content,
      currentGoal: context.currentGoal,
      recentContext: context.recentContext,
      relevantHistory: retrieval.results,
      knowledge: immutableKnowledge,
      relations: context.relations,
      learnerStates: context.learnerStates,
      supportingEvidence: context.supportingEvidence,
      openQuestions: context.openQuestions,
      selfReport: input.selfReport,
      confidence: input.confidence ?? null,
    };
    const common = boundModelContext(rawCommon);
    const evaluated = await stages.withFallback({
      stage: "evaluation",
      data: common,
      schema: evaluatedSchema,
      fallback: { evidence: [], openQuestion: null },
    });
    const evaluation = enforceCopiedDiscount(
      evaluated.value,
      copiedFromTutor(input.content, context.tutorTexts),
    );
    store.evidence(input, evaluation, evaluated.runId);
    const refreshedContext = loadTutorContext(this.db, this.core, input, retrieval.results);
    const refreshedCommon = boundModelContext({
      ...rawCommon,
      learnerStates: refreshedContext.learnerStates,
      supportingEvidence: refreshedContext.supportingEvidence,
    });
    const extracted = await stages.withFallback({
      stage: "extraction",
      data: refreshedCommon,
      schema: extractionSchema,
      fallback: {
        goal: context.currentGoal,
        targets: [],
        prerequisites: [],
        terms: [],
        distinctions: [],
        misconceptions: [],
        claims: [],
        relations: [],
      },
    });
    const candidates = extractionCandidates(extracted.value);
    const resolved = await stages.stage({
      stage: "resolution",
      schema: resolutionSchema,
      data: boundModelContext({
        ...refreshedCommon,
        candidates,
        resolutionCandidates: orderedResolutionCandidates(
          immutableKnowledge,
          retrieval.results,
          candidates.map((item) => item.label),
        ),
      }),
    });
    const first = persistResolution({
      repository: this.knowledge,
      owner: input.owner,
      conversationId: input.conversationId,
      messageId: input.messageId,
      runId: resolved.runId,
      resolution: resolved.value,
      candidates,
      offeredKnowledge: immutableKnowledge,
    });
    store.relations(input, extracted.value.relations, first.resolvedByKey);
    const turnKnowledgeIds = [
      ...new Set([...refreshedContext.selectedKnowledgeIds, ...first.knowledgeIds]),
    ];
    const turnKnowledge = knowledgeContext(this.knowledge, input.owner, turnKnowledgeIds);
    const planned = await stages.stage({
      stage: "planning",
      schema: planningSchema,
      data: boundModelContext({
        ...refreshedCommon,
        micrograph: extracted.value,
        resolution: resolved.value,
        knowledge: turnKnowledge,
        knowledgeIds: first.knowledgeIds,
      }),
    });
    store.plan(input, planned);
    const draft = await stages.stage({
      stage: "draft",
      schema: generatedSchema,
      data: boundModelContext({
        ...refreshedCommon,
        plan: planned.value,
        micrograph: extracted.value,
        assistance: input.assistance,
        selfReport: input.selfReport,
      }),
    });
    const checked = await stages.withFallback({
      stage: "lint",
      schema: lintedSchema,
      data: boundModelContext({
        ...refreshedCommon,
        draft: draft.value.text,
        plan: planned.value,
        knownStates: refreshedContext.learnerStates,
      }),
      fallback: {
        safe: true,
        issues: ["lint_skipped"],
        concepts: [],
        generatedCandidates: [],
        lintSkipped: true,
      },
    });
    let lintChanges: readonly unknown[] = [];
    let allowedKnowledgeIds = first.knowledgeIds;
    if (checked.value.generatedCandidates.length > 0) {
      const generated = checked.value.generatedCandidates;
      const lintResolution = await stages.stage({
        stage: "resolution",
        schema: resolutionSchema,
        data: boundModelContext({
          ...refreshedCommon,
          candidates: generated,
          resolutionCandidates: orderedResolutionCandidates(
            turnKnowledge,
            retrieval.results,
            generated.map((item) => item.label),
          ),
          independentOfGeneration: true,
        }),
      });
      const persisted = persistResolution({
        repository: this.knowledge,
        owner: input.owner,
        conversationId: input.conversationId,
        messageId: input.messageId,
        runId: lintResolution.runId,
        resolution: lintResolution.value,
        candidates: generated,
        offeredKnowledge: turnKnowledge,
      });
      lintChanges = persisted.changes;
      allowedKnowledgeIds = [...new Set([...allowedKnowledgeIds, ...persisted.knowledgeIds])];
    }
    const final = await stages.stage({
      stage: "final",
      schema: finalSchema,
      data: boundModelContext({
        ...refreshedCommon,
        draft: draft.value.text,
        lint: checked.value,
        knowledge: knowledgeContext(this.knowledge, input.owner, allowedKnowledgeIds),
        allowedKnowledgeIds,
      }),
    });
    const reviewed = await new TutorFinalReviewer(this.knowledge, stages, input).review({
      common: refreshedCommon,
      plan: planned.value,
      initialLint: checked.value,
      final,
      allowedKnowledgeIds,
    });
    const tutorMessage = store.reply(
      input,
      reviewed.final,
      reviewed.allowedKnowledgeIds,
      this.provider.state.synthetic,
    );
    const thread = store.thread(input, planned.value.currentGoal, [
      ...(evaluation.openQuestion === null ? [] : [evaluation.openQuestion]),
      ...planned.value.deferredQuestions,
    ]);
    return {
      tutorMessage,
      run: {
        id: final.runId,
        traceId,
        status: "completed",
        stages: stages.runIds.length,
        runIds: stages.runIds,
        extractionFallback: extracted.runId === "fallback",
        lintSkipped: reviewed.lintSkipped,
        retrievalMode: retrieval.mode,
      },
      thread,
      knowledgeChanges: [...first.changes, ...lintChanges],
    };
  }
}
