import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const columnCountRecord = z.object({ count: z.number() });

const addColumn = (raw: DatabaseSync, table: string, name: string, definition: string): void => {
  const row = columnCountRecord.parse(
    raw
      .prepare(`SELECT COUNT(*) AS count FROM pragma_table_info('${table}') WHERE name=?`)
      .get(name),
  );
  if (row.count === 0) raw.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
};

export const migrateKnowledgeMetadata = (raw: DatabaseSync): void => {
  addColumn(raw, "knowledge_revisions", "definition_scope_json", "TEXT NOT NULL DEFAULT '{}'");
  addColumn(raw, "evidence", "evaluator_metadata_json", "TEXT NOT NULL DEFAULT '{}'");
};
