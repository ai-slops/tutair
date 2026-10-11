import type { DatabaseSync } from "node:sqlite";

export function migrateModelRunInspection(raw: DatabaseSync): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS model_run_inspection(
      run_id TEXT PRIMARY KEY REFERENCES model_runs(id) ON DELETE CASCADE,
      trace_id TEXT,
      repair_of_run_id TEXT REFERENCES model_runs(id) ON DELETE SET NULL,
      attempt INTEGER NOT NULL CHECK(attempt > 0),
      output_mode TEXT,
      finished_at TEXT
    );
    CREATE INDEX IF NOT EXISTS model_run_inspection_trace
      ON model_run_inspection(trace_id,run_id);
    CREATE INDEX IF NOT EXISTS model_runs_turn_order
      ON model_runs(learner_id,conversation_id,input_message_id,created_at,id);
  `);
}
