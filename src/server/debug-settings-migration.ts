import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const tableColumn = z.object({ name: z.string() }).loose();

export function migrateDebugSettings(raw: DatabaseSync): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS learner_debug_settings(
      learner_id TEXT PRIMARY KEY REFERENCES learners(id) ON DELETE CASCADE,
      save_provider_reasoning_summaries INTEGER NOT NULL DEFAULT 0 CHECK(save_provider_reasoning_summaries IN(0,1)),
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS model_run_reasoning_summaries(
      run_id TEXT PRIMARY KEY REFERENCES model_runs(id) ON DELETE CASCADE,
      summary_text TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
  `);
  const columns = z
    .array(tableColumn)
    .parse(raw.prepare("PRAGMA table_info(model_run_inspection)").all());
  const hasSetting = columns.some((column) => column.name === "reasoning_summary_enabled");
  if (!hasSetting)
    raw.exec(
      "ALTER TABLE model_run_inspection ADD COLUMN reasoning_summary_enabled INTEGER NOT NULL DEFAULT 0 CHECK(reasoning_summary_enabled IN(0,1))",
    );
}
