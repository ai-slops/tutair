import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Database } from "../../src/server/database.js";

describe("database migrations", () => {
  let directory = "";
  afterEach(() => {
    if (directory !== "") rmSync(directory, { recursive: true, force: true });
  });

  it("adds projection provenance columns to an existing learner-state table", () => {
    // Given
    directory = mkdtempSync(join(tmpdir(), "tutair-migration-test-"));
    const path = join(directory, "legacy.sqlite");
    const legacy = new DatabaseSync(path);
    legacy.exec(
      "CREATE TABLE learner_state(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL,knowledge_id TEXT NOT NULL,revision INTEGER NOT NULL,dimension TEXT NOT NULL,estimate REAL NOT NULL,uncertainty REAL NOT NULL,status TEXT NOT NULL,effective_evidence REAL NOT NULL,last_observation TEXT,projected_at TEXT NOT NULL,UNIQUE(learner_id,knowledge_id,revision,dimension))",
    );
    legacy.close();

    // When
    const migrated = new Database(path);

    // Then
    const columns = migrated.raw.prepare("PRAGMA table_info(learner_state)").all();
    const names = z
      .array(z.object({ name: z.string() }))
      .parse(columns)
      .map((row) => row.name);
    expect(names).toEqual(
      expect.arrayContaining(["knowledge_revision_id", "evidence_ids_json", "projection_version"]),
    );
    migrated.close();
  });
});
