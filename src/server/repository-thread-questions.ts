import type { Database } from "./database.js";
import type { ThreadQuestionRecord } from "./thread-schemas.js";
import { threadQuestionRecord } from "./thread-schemas.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

type QuestionEvent = {
  readonly owner: LearnerId;
  readonly threadId: string;
  readonly questionId: string;
  readonly type: "created" | "status_changed";
  readonly data: Readonly<Record<string, unknown>>;
  readonly now: string;
};

export class ThreadQuestionRepository {
  constructor(private readonly db: Database) {}

  add(owner: LearnerId, threadId: string, question: string): ThreadQuestionRecord {
    const key = question.trim().toLocaleLowerCase();
    const existing = this.db.one(
      "SELECT * FROM open_questions WHERE learner_id=? AND thread_id=? AND lower(trim(question))=?",
      [owner, threadId, key],
      threadQuestionRecord,
    );
    if (existing !== null) return existing;
    const id = newId();
    const now = isoNow();
    this.db.transaction(() => {
      this.db.run(
        "INSERT OR IGNORE INTO open_questions(id,thread_id,learner_id,question,status,created_at) VALUES(?,?,?,?,?,?)",
        [id, threadId, owner, question.trim(), "open", now],
      );
      const inserted = this.get(owner, threadId, key);
      if (inserted.id === id)
        this.event({
          owner,
          threadId,
          questionId: id,
          type: "created",
          data: { status: "open" },
          now,
        });
    });
    return this.get(owner, threadId, key);
  }

  update(
    owner: LearnerId,
    threadId: string,
    id: string,
    status: "open" | "resolved" | "parked",
  ): ThreadQuestionRecord {
    const prior = this.get(owner, threadId, id);
    if (prior.status === status) return prior;
    const now = isoNow();
    this.db.transaction(() => {
      this.db.run(
        "UPDATE open_questions SET status=? WHERE id=? AND thread_id=? AND learner_id=?",
        [status, id, threadId, owner],
      );
      this.event({
        owner,
        threadId,
        questionId: id,
        type: "status_changed",
        data: { from: prior.status, to: status },
        now,
      });
    });
    return this.get(owner, threadId, id);
  }

  private get(owner: LearnerId, threadId: string, idOrKey: string): ThreadQuestionRecord {
    const row = this.db.one(
      "SELECT * FROM open_questions WHERE learner_id=? AND thread_id=? AND (id=? OR lower(trim(question))=?)",
      [owner, threadId, idOrKey, idOrKey],
      threadQuestionRecord,
    );
    if (row === null)
      throw new ApiError(404, "thread_question_not_found", "Thread question not found");
    return row;
  }

  private event(input: QuestionEvent): void {
    this.db.run("INSERT INTO thread_question_events VALUES(?,?,?,?,?,?,?)", [
      newId(),
      input.questionId,
      input.threadId,
      input.owner,
      input.type,
      JSON.stringify(input.data),
      input.now,
    ]);
  }
}
