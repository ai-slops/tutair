import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { migrateTurnRequests } from "../../src/server/turn-request-migration.js";

describe("turn request migration", () => {
  const databases: DatabaseSync[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it("is repeatable and cascades learner privacy erasure", () => {
    // Given
    const raw = new DatabaseSync(":memory:");
    databases.push(raw);
    raw.exec(`
      PRAGMA foreign_keys=ON;
      CREATE TABLE learners(id TEXT PRIMARY KEY);
      CREATE TABLE conversations(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE);
      CREATE TABLE messages(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE);
      INSERT INTO learners VALUES('owner');
      INSERT INTO conversations VALUES('conversation','owner');
      INSERT INTO messages VALUES('message','owner');
    `);

    // When
    migrateTurnRequests(raw);
    migrateTurnRequests(raw);
    raw
      .prepare(
        `INSERT INTO tutor_turn_requests(
         learner_id,conversation_id,request_id,user_message_id,base_hash,state,created_at,updated_at
         ) VALUES(?,?,?,?,?,'running',?,?)`,
      )
      .run("owner", "conversation", crypto.randomUUID(), "message", "hash", "now", "now");
    raw.exec("DELETE FROM learners WHERE id='owner'");

    // Then
    const count = z
      .object({ count: z.number() })
      .parse(raw.prepare("SELECT COUNT(*) AS count FROM tutor_turn_requests").get());
    expect(count.count).toBe(0);
  });
});
