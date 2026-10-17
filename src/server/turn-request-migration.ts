import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const countRow = z.object({ count: z.number() });

const addColumn = (raw: DatabaseSync, name: string, definition: string): void => {
  const row = countRow.parse(
    raw
      .prepare(
        "SELECT COUNT(*) AS count FROM pragma_table_info('tutor_turn_requests') WHERE name=?",
      )
      .get(name),
  );
  if (row.count === 0) raw.exec(`ALTER TABLE tutor_turn_requests ADD COLUMN ${name} ${definition}`);
};

export const migrateTurnRequests = (raw: DatabaseSync): void => {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS tutor_turn_requests(
      learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      request_id TEXT NOT NULL,
      user_message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
      base_hash TEXT NOT NULL,
      state TEXT NOT NULL CHECK(state IN('running','needs_selection','completed','failed')),
      response_json TEXT,
      error_status INTEGER,
      error_code TEXT,
      error_message TEXT,
      error_details_json TEXT,
      tutor_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,
      run_json TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(learner_id,conversation_id,request_id),
      UNIQUE(learner_id,user_message_id)
    );
    CREATE INDEX IF NOT EXISTS tutor_turn_requests_outcomes
      ON tutor_turn_requests(learner_id,conversation_id,state,created_at);
  `);
  addColumn(raw, "runtime_operation_id", "TEXT");
  addColumn(raw, "runtime_phase", "TEXT");
  addColumn(raw, "runtime_effect", "TEXT");
};
