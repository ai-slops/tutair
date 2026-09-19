import { z } from "zod";
import type { Database } from "./database.js";
import type { CoreRepository } from "./repository-core.js";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import type {
  evaluatedSchema,
  extractionSchema,
  finalSchema,
  planningSchema,
  TurnInput,
} from "./tutor-schemas.js";
import type { StageResult } from "./tutor-stage.js";
import { ApiError, isoNow, newId } from "./types.js";

export class TutorTurnStore {
  constructor(
    readonly db: Database,
    readonly core: CoreRepository,
    readonly knowledge: KnowledgeRepository,
  ) {}

  evidence(
    input: TurnInput,
    evaluation: z.infer<typeof evaluatedSchema>,
    evaluationRunId: string,
  ): void {
    for (const item of evaluation.evidence)
      this.knowledge.addEvidence(input.owner, {
        knowledgeId: item.knowledgeId,
        knowledgeRevisionId: item.knowledgeRevisionId,
        revision: item.revision,
        conversationId: input.conversationId,
        messageId: input.messageId,
        dimension: item.dimension,
        evidenceType: item.evidenceType,
        score: item.score,
        polarity: item.polarity,
        strength: item.score,
        evaluatorConfidence: item.evaluatorConfidence,
        evaluator: {
          type: evaluationRunId === "fallback" ? "rule" : "model",
          ...(evaluationRunId === "fallback" ? {} : { modelRunId: evaluationRunId }),
          rubricVersion: "phase1-evidence-v1",
        },
        assistance: {
          hints: input.assistance === "hint" ? 1 : 0,
          answerVisible: input.assistance === "worked_example",
          openBook: input.assistance !== "none",
          copiedFromRecentContext: item.copied,
        },
        supportingSpans: item.sourceSpans,
        limitations: item.limitations,
        relatedUnitIds: item.relatedKnowledgeIds,
        ...(item.assessmentId === null ? {} : { assessmentId: item.assessmentId }),
        ...(item.threadId === null ? {} : { threadId: item.threadId }),
        difficulty: item.difficulty,
      });
  }

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
  ): { readonly id: string } {
    const thread = z
      .object({ id: z.string() })
      .parse(this.thread(input, planned.value.currentGoal, []));
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
    final: StageResult<z.infer<typeof finalSchema>>,
    allowedIds: readonly string[],
    synthetic: boolean,
  ): unknown {
    const approved = new Set(allowedIds);
    const exposed = new Map<string, { readonly revision: number }>();
    for (const declaration of final.value.exposures) {
      const { start, end } = declaration.sourceSpan;
      if (
        !approved.has(declaration.knowledgeId) ||
        end > final.value.text.length ||
        final.value.text.slice(start, end).trim().length === 0
      )
        throw new ApiError(
          422,
          "invalid_exposure_grounding",
          "Tutor exposures must identify approved knowledge and a non-empty final-text span",
        );
      const item = z
        .object({ current_revision: z.number() })
        .parse(this.knowledge.item(input.owner, declaration.knowledgeId));
      exposed.set(declaration.knowledgeId, { revision: item.current_revision });
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
      this.db.run("UPDATE model_runs SET output_message_id=? WHERE id=? AND learner_id=?", [
        tutorMessageId,
        final.runId,
        input.owner,
      ]);
      for (const [id, item] of exposed) {
        this.db.run("INSERT INTO exposures VALUES(?,?,?,?,?,?)", [
          newId(),
          input.owner,
          id,
          item.revision,
          tutorMessageId,
          isoNow(),
        ]);
        this.knowledge.rebuild(input.owner, id);
      }
      return tutorMessage;
    });
  }

  thread(input: TurnInput, goal: string, questions: readonly string[]): unknown {
    const existing = this.db.one(
      `SELECT t.id,t.goal FROM threads t
       JOIN thread_conversations tc ON tc.thread_id=t.id
       WHERE tc.learner_id=? AND tc.conversation_id=? AND t.status='open'
       ORDER BY t.updated_at DESC LIMIT 1`,
      [input.owner, input.conversationId],
      z.object({ id: z.string(), goal: z.string() }),
    );
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
      this.db.run("INSERT INTO open_questions VALUES(?,?,?,?,?,?)", [
        newId(),
        thread.id,
        input.owner,
        question,
        "open",
        isoNow(),
      ]);
    return this.core.thread(input.owner, thread.id);
  }
}
