import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { migrateThreads } from "../../src/server/thread-migration.js";

describe("migrateThreads", () => {
  it("upgrades legacy threads idempotently without deleting duplicate history", () => {
    // Given
    const raw = new DatabaseSync(":memory:");
    raw.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE privacy_mode(singleton INTEGER PRIMARY KEY,active INTEGER NOT NULL);
      INSERT INTO privacy_mode VALUES(1,0);
      CREATE TABLE learners(id TEXT PRIMARY KEY);
      CREATE TABLE conversations(
        id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE
      );
      CREATE TABLE threads(
        id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
        conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
        title TEXT NOT NULL,
        goal TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE open_questions(
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,
        learner_id TEXT NOT NULL,
        question TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      INSERT INTO learners VALUES('learner');
      INSERT INTO conversations VALUES('conversation','learner');
      INSERT INTO threads VALUES(
        'thread','learner','conversation','Legacy','Keep learning','active','created','updated'
      );
      INSERT INTO open_questions VALUES(
        'first','thread','learner','What next?','open','created'
      );
      INSERT INTO open_questions VALUES(
        'duplicate','thread','learner','  what NEXT?  ','open','created'
      );
    `);

    // When
    migrateThreads(raw);
    migrateThreads(raw);

    // Then
    expect(
      raw
        .prepare(
          "SELECT origin,desired_outcome,status,target_knowledge_unit_ids_json FROM threads WHERE id='thread'",
        )
        .get(),
    ).toEqual({
      origin: "question",
      desired_outcome: "Keep learning",
      status: "open",
      target_knowledge_unit_ids_json: "[]",
    });
    expect(raw.prepare("SELECT COUNT(*) AS count FROM open_questions").get()).toEqual({ count: 2 });
    raw
      .prepare("INSERT INTO open_questions VALUES(?,?,?,?,?,?)")
      .run("new-duplicate", "thread", "learner", "WHAT NEXT?", "open", "created");
    expect(raw.prepare("SELECT COUNT(*) AS count FROM open_questions").get()).toEqual({ count: 2 });
    raw
      .prepare("INSERT INTO thread_question_events VALUES(?,?,?,?,?,?,?)")
      .run("event", "first", "thread", "learner", "created", "{}", "created");
    expect(() =>
      raw.prepare("UPDATE thread_question_events SET event_type='changed' WHERE id='event'").run(),
    ).toThrow(/immutable/);
    raw.exec("UPDATE privacy_mode SET active=1; DELETE FROM learners WHERE id='learner'");
    expect(raw.prepare("SELECT COUNT(*) AS count FROM thread_question_events").get()).toEqual({
      count: 0,
    });
    raw.close();
  });

  it("rolls back every schema change when a migration statement fails", () => {
    // Given
    const raw = new DatabaseSync(":memory:");
    raw.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE privacy_mode(singleton INTEGER PRIMARY KEY,active INTEGER NOT NULL);
      INSERT INTO privacy_mode VALUES(1,0);
      CREATE TABLE learners(id TEXT PRIMARY KEY);
      CREATE TABLE conversations(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL);
      CREATE TABLE threads(
        id TEXT PRIMARY KEY,learner_id TEXT NOT NULL,conversation_id TEXT,title TEXT NOT NULL,
        goal TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
      );
      CREATE TABLE open_questions(
        id TEXT PRIMARY KEY,thread_id TEXT NOT NULL,learner_id TEXT NOT NULL,
        question TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL
      );
      CREATE TABLE current_threads(bad TEXT);
    `);

    // When
    const migrate = (): void => migrateThreads(raw);

    // Then
    expect(migrate).toThrow();
    expect(
      raw
        .prepare("SELECT COUNT(*) AS count FROM pragma_table_info('threads') WHERE name='origin'")
        .get(),
    ).toEqual({ count: 0 });
    raw.close();
  });
});
