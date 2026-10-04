import { z } from "zod";
import type { Database } from "./database.js";
import { ThreadQuestionRepository } from "./repository-thread-questions.js";
import { insertThreadEvent, threadEventSnapshot } from "./thread-events.js";
import {
  type ThreadCreate,
  type ThreadRecord,
  type ThreadUpdate,
  threadCreateSchema,
  threadRecord,
} from "./thread-schemas.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

const idRecord = z.object({ id: z.string() });

const unique = (values: readonly string[]): readonly string[] => [...new Set(values)];
export class ThreadRepository {
  private readonly questions: ThreadQuestionRepository;
  constructor(private readonly db: Database) {
    this.questions = new ThreadQuestionRepository(db);
  }

  list(owner: LearnerId): readonly ThreadRecord[] {
    return this.db.all(
      "SELECT * FROM threads WHERE learner_id=? ORDER BY updated_at DESC",
      [owner],
      threadRecord,
    );
  }

  get(owner: LearnerId, id: string): ThreadRecord {
    const row = this.db.one(
      "SELECT * FROM threads WHERE id=? AND learner_id=?",
      [id, owner],
      threadRecord,
    );
    if (row === null) throw new ApiError(404, "thread_not_found", "Thread not found");
    return row;
  }

  create(owner: LearnerId, input: ThreadCreate): ThreadRecord {
    const parsed = threadCreateSchema.parse(input);
    if (parsed.conversationId !== undefined) this.assertConversation(owner, parsed.conversationId);
    const goal = parsed.goal ?? parsed.desiredOutcome;
    if (goal === undefined)
      throw new ApiError(
        422,
        "thread_goal_required",
        "A current goal or desired outcome is required",
      );
    const targets = unique(parsed.targetKnowledgeUnitIds);
    const deferred = unique(parsed.deferredKnowledgeUnitIds).filter((id) => !targets.includes(id));
    this.assertKnowledgeUnits(owner, [...targets, ...deferred]);
    const id = newId();
    const now = isoNow();
    this.db.transaction(() => {
      this.db.run(
        `INSERT INTO threads(
          id,learner_id,conversation_id,title,goal,status,created_at,updated_at,
          origin,why_now,desired_outcome,target_knowledge_unit_ids_json,
          deferred_knowledge_unit_ids_json
        ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          id,
          owner,
          parsed.conversationId ?? null,
          parsed.title,
          goal,
          "open",
          now,
          now,
          parsed.origin,
          parsed.whyNow ?? null,
          parsed.desiredOutcome ?? goal,
          JSON.stringify(targets),
          JSON.stringify(deferred),
        ],
      );
      if (parsed.conversationId !== undefined) {
        this.link(owner, id, parsed.conversationId, now);
        this.setCurrent(owner, parsed.conversationId, id, now);
      }
      insertThreadEvent(this.db, {
        owner,
        threadId: id,
        type: "created",
        data: { thread: threadEventSnapshot(this.get(owner, id)) },
        now,
      });
    });
    return this.get(owner, id);
  }

  update(owner: LearnerId, id: string, input: ThreadUpdate): ThreadRecord {
    const prior = this.get(owner, id);
    const targets = unique(
      input.targetKnowledgeUnitIds ?? this.ids(prior.target_knowledge_unit_ids_json),
    );
    const deferred = unique(
      input.deferredKnowledgeUnitIds ?? this.ids(prior.deferred_knowledge_unit_ids_json),
    ).filter((knowledgeId) => !targets.includes(knowledgeId));
    this.assertKnowledgeUnits(owner, [...targets, ...deferred]);
    const now = isoNow();
    const next = {
      title: input.title ?? prior.title,
      goal: input.goal ?? prior.goal,
      origin: input.origin ?? prior.origin,
      whyNow: input.whyNow === undefined ? prior.why_now : input.whyNow,
      desiredOutcome: input.desiredOutcome ?? prior.desired_outcome,
      status: input.status ?? prior.status,
    };
    this.db.transaction(() => {
      this.db.run(
        `UPDATE threads SET title=?,goal=?,origin=?,why_now=?,desired_outcome=?,
         target_knowledge_unit_ids_json=?,deferred_knowledge_unit_ids_json=?,status=?,updated_at=?
         WHERE id=? AND learner_id=?`,
        [
          next.title,
          next.goal,
          next.origin,
          next.whyNow,
          next.desiredOutcome,
          JSON.stringify(targets),
          JSON.stringify(deferred),
          next.status,
          now,
          id,
          owner,
        ],
      );
      if (next.status !== "open")
        this.db.run("DELETE FROM current_threads WHERE learner_id=? AND thread_id=?", [owner, id]);
      insertThreadEvent(this.db, {
        owner,
        threadId: id,
        type: "updated",
        data: {
          before: threadEventSnapshot(prior),
          after: threadEventSnapshot(this.get(owner, id)),
        },
        now,
      });
    });
    return this.get(owner, id);
  }

  addQuestion(owner: LearnerId, threadId: string, question: string) {
    this.get(owner, threadId);
    return this.questions.add(owner, threadId, question);
  }

  updateQuestion(
    owner: LearnerId,
    threadId: string,
    id: string,
    status: "open" | "resolved" | "parked",
  ) {
    this.get(owner, threadId);
    return this.questions.update(owner, threadId, id, status);
  }

  current(owner: LearnerId, conversationId: string): ThreadRecord | null {
    return this.db.one(
      `SELECT t.* FROM threads t JOIN current_threads c ON c.thread_id=t.id
       WHERE c.learner_id=? AND c.conversation_id=? AND t.status='open'`,
      [owner, conversationId],
      threadRecord,
    );
  }

  select(owner: LearnerId, conversationId: string, id: string, reason: string): ThreadRecord {
    const thread = this.get(owner, id);
    this.assertConversation(owner, conversationId);
    const resumesInactive = reason === "explicit_resume";
    if (thread.status !== "open" && !resumesInactive)
      throw new ApiError(
        409,
        "thread_not_open",
        "Thread is not open; use the explicit resume endpoint",
      );
    const now = isoNow();
    this.db.transaction(() => {
      this.link(owner, id, conversationId, now);
      this.setCurrent(owner, conversationId, id, now);
      this.db.run(
        `UPDATE threads SET conversation_id=?,status=?,updated_at=?
         WHERE id=? AND learner_id=?`,
        [conversationId, resumesInactive ? "open" : thread.status, now, id, owner],
      );
      if (thread.conversation_id !== conversationId || thread.status !== "open")
        insertThreadEvent(this.db, {
          owner,
          threadId: id,
          type: "selected",
          data: { conversationId, reason },
          now,
        });
    });
    return this.get(owner, id);
  }

  private assertConversation(owner: LearnerId, id: string): void {
    if (
      this.db.one(
        "SELECT id FROM conversations WHERE id=? AND learner_id=?",
        [id, owner],
        idRecord,
      ) === null
    )
      throw new ApiError(404, "conversation_not_found", "Conversation not found");
  }

  private assertKnowledgeUnits(owner: LearnerId, ids: readonly string[]): void {
    for (const id of unique(ids)) {
      const row = this.db.one(
        "SELECT id FROM knowledge_items WHERE id=? AND (learner_id=? OR learner_id IS NULL)",
        [id, owner],
        idRecord,
      );
      if (row === null)
        throw new ApiError(
          422,
          "invalid_thread_knowledge_unit",
          "Thread knowledge unit is not learner-owned or canonical",
        );
    }
  }

  private ids(json: string): readonly string[] {
    return z.array(z.string().uuid()).parse(JSON.parse(json));
  }

  private link(owner: LearnerId, threadId: string, conversationId: string, now: string): void {
    this.db.run("INSERT OR IGNORE INTO thread_conversations VALUES(?,?,?,?)", [
      threadId,
      conversationId,
      owner,
      now,
    ]);
  }

  private setCurrent(
    owner: LearnerId,
    conversationId: string,
    threadId: string,
    now: string,
  ): void {
    this.db.run(
      `INSERT INTO current_threads(learner_id,conversation_id,thread_id,selected_at) VALUES(?,?,?,?)
       ON CONFLICT(learner_id,conversation_id) DO UPDATE SET thread_id=excluded.thread_id,selected_at=excluded.selected_at`,
      [owner, conversationId, threadId, now],
    );
  }
}
