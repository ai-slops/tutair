import { z } from "zod";
import type { Database } from "./database.js";
import { KnowledgeDocumentRepository } from "./knowledge-document-repository.js";
import { ModelRunner } from "./model-runner.js";
import type { TutorProvider } from "./provider.js";
import type { CoreRepository } from "./repository-core.js";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import { MisconceptionRepository } from "./repository-misconceptions.js";
import { searchKnowledge } from "./search.js";
import { loadTutorContext } from "./tutor-context.js";
import { evaluationSchemaFor } from "./tutor-evaluation-boundary.js";
import { TutorEvidenceStore } from "./tutor-evidence-store.js";
import {
  extractionCandidates,
  knowledgeContext,
  orderedResolutionCandidates,
  persistResolution,
  resolutionProbeQueries,
} from "./tutor-knowledge.js";
import { misconceptionRiskContext } from "./tutor-misconception-context.js";
import { boundModelContext } from "./tutor-model-context.js";
import { copiedFromTutor, enforceCopiedDiscount } from "./tutor-policies.js";
import { TutorResponseService } from "./tutor-response.js";
import {
  extractionSchema,
  planningSchema,
  resolutionSchema,
  type TurnInput,
} from "./tutor-schemas.js";
import { TutorStageRunner } from "./tutor-stage.js";
import { selectTutorThread } from "./tutor-thread-selection.js";
import { loadTurnKnowledge } from "./tutor-turn-context.js";
import { TutorTurnStore } from "./tutor-turn-store.js";
import { ApiError, newId } from "./types.js";

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

  async turn(request: TurnInput): Promise<{
    readonly tutorMessage: unknown;
    readonly run: unknown;
    readonly thread: unknown;
    readonly knowledgeChanges: readonly unknown[];
  }> {
    const traceId = newId();
    const source = this.db.one(
      `SELECT e.id,e.content FROM message_events e JOIN messages m ON m.id=e.message_id
       WHERE e.message_id=? AND e.learner_id=? AND m.learner_id=? AND m.conversation_id=?
         AND m.role='learner' AND e.event_type='created'`,
      [request.messageId, request.owner, request.owner, request.conversationId],
      z.object({ id: z.string(), content: z.string() }),
    );
    if (source === null || source.content !== request.content)
      throw new ApiError(
        422,
        "invalid_turn_source",
        "Turn input must match its original learner message",
      );
    const retrieval = await searchKnowledge(
      this.db,
      this.provider,
      request.owner,
      request.content,
      16,
    );
    const selectedThread = selectTutorThread(this.core, request, retrieval.results);
    const input = { ...request, threadId: selectedThread.id, messageEventId: source.id };
    const stages = new TutorStageRunner(this.runner, input);
    const store = new TutorTurnStore(this.db, this.core, this.knowledge);
    const context = loadTutorContext(this.db, this.core, input, retrieval.results);
    const immutableKnowledge = knowledgeContext(
      this.knowledge,
      input.owner,
      context.selectedKnowledgeIds,
    );
    const rawCommon = {
      traceId,
      message: input.content,
      sourceMessageEventId: input.messageEventId,
      currentGoal: context.currentGoal,
      learningThread: context.learningThread,
      recentContext: context.recentContext,
      relevantHistory: retrieval.results,
      knowledge: immutableKnowledge,
      relations: context.relations,
      learnerStates: context.learnerStates,
      supportingEvidence: context.supportingEvidence,
      openQuestions: context.openQuestions,
      assessments: context.assessments,
      selfReport: input.selfReport,
      confidence: input.confidence ?? null,
    };
    const common = boundModelContext(rawCommon);
    const evaluated = await stages.withFallback({
      stage: "evaluation",
      data: common,
      schema: evaluationSchemaFor(immutableKnowledge, input, context.assessments),
      fallback: {
        evidence: [],
        openQuestion: null,
        unresolvedAmbiguities: [],
        suggestedFollowup: null,
      },
    });
    const evaluation = enforceCopiedDiscount(
      evaluated.value,
      copiedFromTutor(input.content, context.tutorTexts),
    );
    const evaluationOutcome = new TutorEvidenceStore(this.knowledge).record(
      input,
      { ...evaluated, value: evaluation },
      immutableKnowledge,
    );
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
        sourceLanguage: "en",
        responseLanguage: "en",
        artifacts: [],
        relations: [],
      },
    });
    const candidates = extractionCandidates(extracted.value);
    const resolutionRetrieval = [...retrieval.results];
    for (const query of resolutionProbeQueries(candidates)) {
      const probe = await searchKnowledge(this.db, this.provider, input.owner, query, 8);
      resolutionRetrieval.push(...probe.results);
    }
    const retrievedKnowledgeIds = resolutionRetrieval.flatMap((raw) => {
      const parsed = z.object({ id: z.string() }).safeParse(raw);
      return parsed.success ? [parsed.data.id] : [];
    });
    const offeredKnowledge = knowledgeContext(this.knowledge, input.owner, [
      ...new Set([...context.selectedKnowledgeIds, ...retrievedKnowledgeIds]),
    ]);
    const resolved = await stages.stage({
      stage: "resolution",
      schema: resolutionSchema,
      data: boundModelContext({
        ...refreshedCommon,
        candidates,
        resolutionCandidates: orderedResolutionCandidates(
          offeredKnowledge,
          resolutionRetrieval,
          candidates.map((item) => item.label),
        ),
      }),
    });
    const first = persistResolution({
      repository: this.knowledge,
      owner: input.owner,
      conversationId: input.conversationId,
      messageId: input.messageId,
      extractionRunId: extracted.runId,
      runId: resolved.runId,
      resolution: resolved.value,
      candidates,
      offeredKnowledge,
    });
    store.relations(input, extracted.value.relations, first.resolvedByKey);
    const turnKnowledgeIds = [
      ...new Set([...first.knowledgeIds, ...refreshedContext.selectedKnowledgeIds]),
    ].slice(0, 24);
    const turnKnowledge = loadTurnKnowledge(this.knowledge, input.owner, turnKnowledgeIds);
    const misconceptionRisks = misconceptionRiskContext(
      new MisconceptionRepository(this.db),
      input.owner,
      turnKnowledge.knowledge.map((item) => item.revisionId),
    );
    const turnCommon = boundModelContext({
      ...refreshedCommon,
      ...turnKnowledge,
      micrograph: extracted.value,
      misconceptionRisks,
    });
    const planned = await stages.stage({
      stage: "planning",
      schema: planningSchema,
      data: boundModelContext({
        ...turnCommon,
        resolution: resolved.value,
        knowledgeIds: first.knowledgeIds,
      }),
    });
    store.plan(
      input,
      planned,
      turnKnowledge.knowledge.map((item) => item.id),
    );
    const reviewed = await new TutorResponseService(
      this.knowledge,
      new KnowledgeDocumentRepository(this.db),
      stages,
    ).generate({
      common: turnCommon,
      plan: planned.value,
      knowledge: turnKnowledge.knowledge,
      responseLanguage: extracted.value.responseLanguage,
    });
    const tutorMessage = store.reply(
      input,
      reviewed.final,
      reviewed.knowledge,
      this.provider.state.synthetic,
    );
    const thread = store.thread(input, planned.value.currentGoal, [
      ...(evaluation.openQuestion === null ? [] : [evaluation.openQuestion]),
      ...(evaluationOutcome.followupQuestion === null ? [] : [evaluationOutcome.followupQuestion]),
      ...planned.value.deferredQuestions,
    ]);
    return {
      tutorMessage,
      run: {
        id: reviewed.runId,
        traceId,
        status: "completed",
        stages: stages.runIds.length,
        runIds: stages.runIds,
        extractionFallback: extracted.runId === "fallback",
        evaluationSkipped: evaluated.runId === "fallback",
        followupTrackingSkipped: evaluationOutcome.followupTrackingSkipped,
        lintSkipped: reviewed.lintSkipped,
        retrievalMode: retrieval.mode,
        exposureTrackingSkipped: reviewed.final.discardedExposures.length > 0,
      },
      thread,
      knowledgeChanges: [...first.changes, ...reviewed.changes],
    };
  }
}
