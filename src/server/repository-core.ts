import { createHash, randomBytes } from "node:crypto";
import type { Database } from "./database.js";
import {
  conversationRecord,
  learnerRecord,
  messageRecord,
  sessionRecord,
  threadRecord,
} from "./records.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

const hash = (token: string): string => createHash("sha256").update(token).digest("hex");

export class CoreRepository {
  constructor(readonly db: Database) {}
  signup(displayName: string): { readonly token: string; readonly learner: unknown } {
    const id = newId();
    const token = randomBytes(32).toString("base64url");
    const now = isoNow();
    this.db.transaction(() => {
      this.db.run("INSERT INTO learners VALUES(?,?,?)", [id, displayName, now]);
      this.db.run("INSERT INTO sessions VALUES(?,?,?,?,?)", [
        newId(),
        id,
        hash(token),
        now,
        new Date(Date.now() + 31_536_000_000).toISOString(),
      ]);
    });
    return {
      token,
      learner: this.db.one("SELECT * FROM learners WHERE id=?", [id], learnerRecord),
    };
  }
  authenticate(token: string): LearnerId | null {
    const row = this.db.one(
      "SELECT * FROM sessions WHERE token_hash=? AND expires_at>?",
      [hash(token), isoNow()],
      sessionRecord,
    );
    return row === null ? null : row.learner_id;
  }
  learner(id: LearnerId): unknown {
    return this.db.one("SELECT * FROM learners WHERE id=?", [id], learnerRecord);
  }
  conversations(owner: LearnerId): readonly unknown[] {
    return this.db.all(
      "SELECT * FROM conversations WHERE learner_id=? ORDER BY updated_at DESC",
      [owner],
      conversationRecord,
    );
  }
  createConversation(owner: LearnerId, title: string, goal: string | null): unknown {
    const id = newId();
    const now = isoNow();
    this.db.run("INSERT INTO conversations VALUES(?,?,?,?,?,?)", [
      id,
      owner,
      title,
      goal,
      now,
      now,
    ]);
    return this.conversation(owner, id);
  }
  conversation(owner: LearnerId, id: string): unknown {
    const row = this.db.one(
      "SELECT * FROM conversations WHERE id=? AND learner_id=?",
      [id, owner],
      conversationRecord,
    );
    if (row === null) throw new ApiError(404, "conversation_not_found", "Conversation not found");
    return row;
  }
  messages(owner: LearnerId, conversationId: string): readonly unknown[] {
    this.conversation(owner, conversationId);
    return this.db.all(
      "SELECT * FROM messages WHERE learner_id=? AND conversation_id=? AND tombstoned_at IS NULL ORDER BY created_at",
      [owner, conversationId],
      messageRecord,
    );
  }
  createMessage(
    owner: LearnerId,
    conversationId: string,
    role: "learner" | "tutor",
    content: string,
    synthetic = false,
  ): unknown {
    this.conversation(owner, conversationId);
    const id = newId();
    const now = isoNow();
    this.db.transaction(() => {
      this.db.run("INSERT INTO messages VALUES(?,?,?,?,?,?,?,?,?)", [
        id,
        owner,
        conversationId,
        role,
        content,
        synthetic ? 1 : 0,
        null,
        now,
        now,
      ]);
      this.db.run("INSERT INTO message_events VALUES(?,?,?,?,?,?,?)", [
        newId(),
        id,
        owner,
        "created",
        null,
        content,
        now,
      ]);
      this.db.run("UPDATE conversations SET updated_at=? WHERE id=? AND learner_id=?", [
        now,
        conversationId,
        owner,
      ]);
    });
    return this.message(owner, id);
  }
  message(owner: LearnerId, id: string) {
    const row = this.db.one(
      "SELECT * FROM messages WHERE id=? AND learner_id=?",
      [id, owner],
      messageRecord,
    );
    if (row === null) throw new ApiError(404, "message_not_found", "Message not found");
    return row;
  }
  editMessage(owner: LearnerId, conversationId: string, id: string, content: string): unknown {
    const prior = this.message(owner, id);
    if (prior.conversation_id !== conversationId || prior.tombstoned_at !== null)
      throw new ApiError(404, "message_not_found", "Message not found");
    const now = isoNow();
    this.db.transaction(() => {
      this.db.run("UPDATE messages SET content=?,updated_at=? WHERE id=? AND learner_id=?", [
        content,
        now,
        id,
        owner,
      ]);
      this.db.run(
        "DELETE FROM embedding_cache WHERE learner_id=? AND entity_type='message' AND entity_id=?",
        [owner, id],
      );
      this.db.run("INSERT INTO message_events VALUES(?,?,?,?,?,?,?)", [
        newId(),
        id,
        owner,
        "edited",
        prior.content,
        content,
        now,
      ]);
    });
    return this.message(owner, id);
  }
  tombstone(owner: LearnerId, conversationId: string, id: string): void {
    const prior = this.message(owner, id);
    if (prior.conversation_id !== conversationId)
      throw new ApiError(404, "message_not_found", "Message not found");
    const now = isoNow();
    this.db.transaction(() => {
      this.db.run(
        "UPDATE messages SET content='',tombstoned_at=?,updated_at=? WHERE id=? AND learner_id=?",
        [now, now, id, owner],
      );
      this.db.run(
        "DELETE FROM embedding_cache WHERE learner_id=? AND entity_type='message' AND entity_id=?",
        [owner, id],
      );
      this.db.run("INSERT INTO message_events VALUES(?,?,?,?,?,?,?)", [
        newId(),
        id,
        owner,
        "tombstoned",
        prior.content,
        null,
        now,
      ]);
    });
  }
  threads(owner: LearnerId): readonly unknown[] {
    return this.db.all(
      "SELECT * FROM threads WHERE learner_id=? ORDER BY updated_at DESC",
      [owner],
      threadRecord,
    );
  }
  thread(owner: LearnerId, id: string) {
    const row = this.db.one(
      "SELECT * FROM threads WHERE id=? AND learner_id=?",
      [id, owner],
      threadRecord,
    );
    if (row === null) throw new ApiError(404, "thread_not_found", "Thread not found");
    return row;
  }
  createThread(
    owner: LearnerId,
    input: {
      readonly title: string;
      readonly goal: string;
      readonly conversationId?: string | undefined;
    },
  ): unknown {
    if (input.conversationId !== undefined) this.conversation(owner, input.conversationId);
    const id = newId();
    const now = isoNow();
    this.db.transaction(() => {
      this.db.run("INSERT INTO threads VALUES(?,?,?,?,?,?,?,?)", [
        id,
        owner,
        input.conversationId ?? null,
        input.title,
        input.goal,
        "open",
        now,
        now,
      ]);
      if (input.conversationId !== undefined)
        this.db.run("INSERT INTO thread_conversations VALUES(?,?,?,?)", [
          id,
          input.conversationId,
          owner,
          now,
        ]);
      this.db.run("INSERT INTO thread_events VALUES(?,?,?,?,?,?)", [
        newId(),
        id,
        owner,
        "created",
        JSON.stringify({ conversationId: input.conversationId ?? null }),
        now,
      ]);
    });
    return this.thread(owner, id);
  }
}
