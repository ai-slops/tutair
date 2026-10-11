import { z } from "zod";
import { AnswerCompositionStore, type RenderedAnswer } from "./answer-composition.js";
import type { Database } from "./database.js";
import { type DiscardedExposure, exposureGroundingFailure } from "./exposure-grounding.js";
import type { CoreRepository } from "./repository-core.js";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import type { KnowledgeContext } from "./tutor-knowledge.js";
import type { extractionSchema, finalSchema, planningSchema, TurnInput } from "./tutor-schemas.js";
import type { StageResult } from "./tutor-stage.js";
import { ApiError, isoNow, newId } from "./types.js";

export class TutorTurnStore {
  constructor(
    readonly db: Database,
    readonly core: CoreRepository,
    readonly knowledge: KnowledgeRepository,
  ) {}

  relations(
    input: TurnInput,
    relations: z.infer<typeof extractionSchema>["relations"],
    resolved: ReadonlyMap<string, { readonly knowledgeId: string; readonly revisionId: string }>,
  ): void {
    for (const relation of relations) {
      const from = resolved.get(relation.fromKey);
      const to = resolved.get(relation.toKey);
      if (from !== undefined && to !== undefined)
        this.db.run("INSERT INTO knowledge_relations VALUES(?,?,?,?,?,?,?,?,?,?)", [
          newId(),
          input.owner,
          from.knowledgeId,
          to.knowledgeId,
          relation.type,
          from.revisionId,
          to.revisionId,
          String(relation.necessity),
          relation.scaffoldable ? 1 : 0,
          isoNow(),
        ]);
    }
  }

  plan(
    input: TurnInput,
    planned: StageResult<z.infer<typeof planningSchema>>,
    offeredKnowledgeIds: readonly string[],
  ): { readonly id: string } {
    const thread = z
      .object({ id: z.string() })
      .parse(this.thread(input, planned.value.currentGoal, []));
    const prior = this.core.thread(input.owner, thread.id);
    const offered = new Set(offeredKnowledgeIds);
    const priorTargets = z
      .array(z.string())
      .parse(JSON.parse(prior.target_knowledge_unit_ids_json));
    const priorDeferred = z
      .array(z.string())
      .parse(JSON.parse(prior.deferred_knowledge_unit_ids_json));
    const targetKnowledgeUnitIds = [
      ...new Set([...priorTargets, ...planned.value.targetUnits.filter((id) => offered.has(id))]),
    ];
    const deferredKnowledgeUnitIds = [
      ...new Set([
        ...priorDeferred,
        ...planned.value.deferredUnits.filter((id) => offered.has(id)),
      ]),
    ].filter((id) => !targetKnowledgeUnitIds.includes(id));
    if (
      JSON.stringify(priorTargets) !== JSON.stringify(targetKnowledgeUnitIds) ||
      JSON.stringify(priorDeferred) !== JSON.stringify(deferredKnowledgeUnitIds)
    ) {
      this.core.updateThread(input.owner, thread.id, {
        targetKnowledgeUnitIds,
        deferredKnowledgeUnitIds,
      });
    }
    this.db.run("INSERT INTO turn_plans VALUES(?,?,?,?,?,?,?)", [
      newId(),
      input.owner,
      input.conversationId,
      thread.id,
      planned.runId,
      JSON.stringify(planned.value),
      isoNow(),
    ]);
    for (const opportunity of planned.value.assessmentOpportunities)
      this.db.run("INSERT INTO assessments VALUES(?,?,?,?,?,?)", [
        newId(),
        input.owner,
        input.conversationId,
        thread.id,
        JSON.stringify(opportunity),
        isoNow(),
      ]);
    return thread;
  }

  reply(
    input: TurnInput,
    final: StageResult<z.infer<typeof finalSchema>> & {
      readonly discardedExposures?: readonly DiscardedExposure[];
      readonly rendered: RenderedAnswer;
    },
    generationKnowledge: readonly KnowledgeContext[],
    synthetic: boolean,
  ): unknown {
    const snapshots = new Map(generationKnowledge.map((item) => [item.id, item]));
    const approved = new Set(snapshots.keys());
    const exposed = new Map<string, KnowledgeContext>();
    for (const declaration of final.value.exposures) {
      const snapshot = snapshots.get(declaration.knowledgeId);
      if (
        snapshot === undefined ||
        exposureGroundingFailure(final.value.text, declaration, approved) !== null
      )
        throw new ApiError(
          422,
          "invalid_exposure_grounding",
          "Tutor exposures must identify approved knowledge and a non-empty final-text span",
        );
      exposed.set(declaration.knowledgeId, snapshot);
    }
    return this.db.transaction(() => {
      const tutorMessage = this.core.createMessage(
        input.owner,
        input.conversationId,
        "tutor",
        final.value.text,
        synthetic,
      );
      const tutorMessageId = z.object({ id: z.string() }).parse(tutorMessage).id;
      new AnswerCompositionStore(this.db).save({
        owner: input.owner,
        messageId: tutorMessageId,
        runId: final.runId,
        rendered: final.rendered,
      });
      const sourceEvent = z
        .object({ id: z.string() })
        .parse(
          this.db.one(
            "SELECT id FROM message_events WHERE message_id=? AND learner_id=? AND event_type='created'",
            [tutorMessageId, input.owner],
            z.object({ id: z.string() }),
          ),
        );
      this.db.run("UPDATE model_runs SET output_message_id=? WHERE id=? AND learner_id=?", [
        tutorMessageId,
        final.runId,
        input.owner,
      ]);
      for (const [id, item] of exposed) {
        this.db.run(
          "INSERT INTO exposures(id,learner_id,knowledge_id,revision,message_id,created_at,knowledge_revision_id,message_event_id,provenance) VALUES(?,?,?,?,?,?,?,?,?)",
          [
            newId(),
            input.owner,
            id,
            item.revision,
            tutorMessageId,
            isoNow(),
            item.revisionId,
            sourceEvent.id,
            "generation_snapshot",
          ],
        );
        this.knowledge.rebuild(input.owner, id);
      }
      if (final.discardedExposures?.length) {
        this.db.run("INSERT INTO traces VALUES(?,?,?,?,?,?)", [
          newId(),
          input.owner,
          final.runId,
          "exposure_grounding_skipped",
          JSON.stringify({
            conversationId: input.conversationId,
            messageId: input.messageId,
            tutorMessageId,
            sourceModelRunId: final.runId,
            discarded: final.discardedExposures,
          }),
          isoNow(),
        ]);
      }
      return tutorMessage;
    });
  }

  thread(input: TurnInput, goal: string, questions: readonly string[]): unknown {
    const existing =
      input.threadId === undefined
        ? this.core.currentThread(input.owner, input.conversationId)
        : this.core.thread(input.owner, input.threadId);
    const thread =
      existing ??
      z.object({ id: z.string(), goal: z.string() }).parse(
        this.core.createThread(input.owner, {
          title: goal.slice(0, 160),
          goal,
          conversationId: input.conversationId,
        }),
      );
    if (existing !== null && thread.goal !== goal) {
      const now = isoNow();
      this.db.transaction(() => {
        this.db.run("UPDATE threads SET goal=?,updated_at=? WHERE id=? AND learner_id=?", [
          goal,
          now,
          thread.id,
          input.owner,
        ]);
        this.db.run("INSERT INTO thread_events VALUES(?,?,?,?,?,?)", [
          newId(),
          thread.id,
          input.owner,
          "goal_updated",
          JSON.stringify({ priorGoal: thread.goal, goal }),
          now,
        ]);
      });
    }
    for (const question of new Set(questions))
      this.core.addThreadQuestion(input.owner, thread.id, question);
    return this.core.thread(input.owner, thread.id);
  }
}
