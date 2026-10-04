import type { DatabaseSync } from "node:sqlite";

export function migrateModelContexts(raw: DatabaseSync): void {
  raw.exec("BEGIN IMMEDIATE");
  try {
    raw.exec(`
      CREATE TABLE IF NOT EXISTS model_run_contexts(
        run_id TEXT PRIMARY KEY REFERENCES model_runs(id) ON DELETE CASCADE,
        learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
        context_version TEXT NOT NULL,
        context_json TEXT NOT NULL,
        context_hash TEXT NOT NULL CHECK(length(context_hash)=64),
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS model_run_contexts_owner
        ON model_run_contexts(learner_id,created_at,run_id);
      CREATE TRIGGER IF NOT EXISTS immutable_model_run_contexts_insert
      BEFORE INSERT ON model_run_contexts
      WHEN EXISTS (SELECT 1 FROM model_run_contexts WHERE run_id=NEW.run_id)
      BEGIN SELECT RAISE(ABORT,'model run contexts are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS model_run_context_owner_insert
      BEFORE INSERT ON model_run_contexts
      WHEN NOT EXISTS (
        SELECT 1 FROM model_runs
        WHERE id=NEW.run_id AND learner_id=NEW.learner_id
      )
      BEGIN SELECT RAISE(ABORT,'model run context owner mismatch'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_model_run_contexts_update
      BEFORE UPDATE ON model_run_contexts
      BEGIN SELECT RAISE(ABORT,'model run contexts are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_model_run_contexts_delete
      BEFORE DELETE ON model_run_contexts
      WHEN COALESCE((SELECT active FROM privacy_mode WHERE singleton=1),0)<>1
      BEGIN SELECT RAISE(ABORT,'model run contexts are immutable'); END;
    `);
    raw.exec("COMMIT");
  } catch (error) {
    raw.exec("ROLLBACK");
    throw error;
  }
}
