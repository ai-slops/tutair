import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const countRow = z.object({ count: z.number() });

const addColumn = (raw: DatabaseSync, name: string): void => {
  const row = countRow.parse(
    raw
      .prepare(
        "SELECT COUNT(*) AS count FROM pragma_table_info('model_run_inspection') WHERE name=?",
      )
      .get(name),
  );
  if (row.count === 0) raw.exec(`ALTER TABLE model_run_inspection ADD COLUMN ${name} TEXT`);
};

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
  addColumn(raw, "runtime_operation_id");
  addColumn(raw, "provider_operation_id");
  addColumn(raw, "provider_attempt_id");
  addColumn(raw, "effect_state");
  addColumn(raw, "cancellation_state");
}
