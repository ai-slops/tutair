import type { DatabaseSync } from "node:sqlite";

export function migrateAnswerCompositions(raw: DatabaseSync): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS answer_compositions(
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
      message_id TEXT NOT NULL UNIQUE REFERENCES messages(id) ON DELETE CASCADE,
      model_run_id TEXT REFERENCES model_runs(id) ON DELETE SET NULL,
      content_hash TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS answer_composition_segments(
      id TEXT PRIMARY KEY,
      composition_id TEXT NOT NULL REFERENCES answer_compositions(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      source_type TEXT NOT NULL CHECK(source_type IN('block','template')),
      source_block_id TEXT REFERENCES knowledge_document_blocks(id) ON DELETE CASCADE,
      template_key TEXT,
      layout TEXT NOT NULL,
      rendered_text TEXT NOT NULL,
      start_offset INTEGER NOT NULL,
      end_offset INTEGER NOT NULL,
      content_hash TEXT NOT NULL,
      UNIQUE(composition_id,position)
    );
    CREATE TRIGGER IF NOT EXISTS immutable_answer_compositions_update
      BEFORE UPDATE ON answer_compositions BEGIN SELECT RAISE(ABORT,'answer compositions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_answer_segments_update
      BEFORE UPDATE ON answer_composition_segments BEGIN SELECT RAISE(ABORT,'answer segments are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_answer_compositions_delete
      BEFORE DELETE ON answer_compositions WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0
      BEGIN SELECT RAISE(ABORT,'answer compositions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_answer_segments_delete
      BEFORE DELETE ON answer_composition_segments WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0
      BEGIN SELECT RAISE(ABORT,'answer segments are immutable'); END;
  `);
}
