import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const countRecord = z.object({ count: z.number() });

const addColumn = (raw: DatabaseSync, table: string, name: string, definition: string): void => {
  const row = countRecord.parse(
    raw
      .prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('${table}') WHERE name=?`)
      .get(name),
  );
  if (row.count === 0) raw.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
};

export const migrateThreads = (raw: DatabaseSync): void => {
  const nested = raw.isTransaction;
  raw.exec(nested ? "SAVEPOINT migrate_threads" : "BEGIN IMMEDIATE");
  try {
    addColumn(raw, "threads", "origin", "TEXT NOT NULL DEFAULT 'question'");
    addColumn(raw, "threads", "why_now", "TEXT");
    addColumn(raw, "threads", "desired_outcome", "TEXT NOT NULL DEFAULT ''");
    addColumn(raw, "threads", "target_knowledge_unit_ids_json", "TEXT NOT NULL DEFAULT '[]'");
    addColumn(raw, "threads", "deferred_knowledge_unit_ids_json", "TEXT NOT NULL DEFAULT '[]'");
    raw.exec(`
      UPDATE threads SET desired_outcome=goal WHERE desired_outcome='';
      UPDATE threads SET status='open' WHERE status='active';
      UPDATE threads SET status='paused' WHERE status='parked';
      DROP INDEX IF EXISTS open_question_dedup;
      CREATE INDEX IF NOT EXISTS open_question_lookup
        ON open_questions(learner_id,thread_id,lower(trim(question)));
      CREATE TRIGGER IF NOT EXISTS deduplicate_open_questions
        BEFORE INSERT ON open_questions
        WHEN EXISTS(
          SELECT 1 FROM open_questions
          WHERE learner_id=NEW.learner_id AND thread_id=NEW.thread_id
            AND lower(trim(question))=lower(trim(NEW.question))
        ) BEGIN SELECT RAISE(IGNORE); END;
      CREATE TABLE IF NOT EXISTS thread_question_events(
        id TEXT PRIMARY KEY,
        question_id TEXT NOT NULL REFERENCES open_questions(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
        event_type TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS current_threads(
        learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
        conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        selected_at TEXT NOT NULL,
        PRIMARY KEY(learner_id,conversation_id)
      );
      INSERT OR IGNORE INTO current_threads(learner_id,conversation_id,thread_id,selected_at)
        SELECT learner_id,conversation_id,id,updated_at FROM threads
        WHERE conversation_id IS NOT NULL AND status='open'
        ORDER BY updated_at DESC;
      CREATE TRIGGER IF NOT EXISTS immutable_thread_question_events_update
        BEFORE UPDATE ON thread_question_events BEGIN
          SELECT RAISE(ABORT,'thread question events are immutable');
        END;
      CREATE TRIGGER IF NOT EXISTS immutable_thread_question_events_delete
        BEFORE DELETE ON thread_question_events
        WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN
          SELECT RAISE(ABORT,'thread question events are immutable');
        END;
    `);
    raw.exec(nested ? "RELEASE SAVEPOINT migrate_threads" : "COMMIT");
  } catch (error) {
    raw.exec(
      nested
        ? "ROLLBACK TO SAVEPOINT migrate_threads; RELEASE SAVEPOINT migrate_threads"
        : "ROLLBACK",
    );
    throw error;
  }
};
