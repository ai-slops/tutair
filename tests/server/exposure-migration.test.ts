import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Database } from "../../src/server/database.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import { KnowledgeRepository } from "../../src/server/repository-knowledge.js";

describe("legacy exposure migration", () => {
  const directories: string[] = [];
  const databases: Database[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
    for (const directory of directories.splice(0))
      rmSync(directory, { recursive: true, force: true });
  });

  function legacyDatabase() {
    const directory = mkdtempSync(join(tmpdir(), "tutair-exposure-migration-"));
    directories.push(directory);
    const path = join(directory, "legacy.sqlite");
    const database = new Database(path);
    const core = new CoreRepository(database);
    const owner = z.object({ learner: z.object({ id: z.string() }) }).parse(core.signup("Legacy"))
      .learner.id;
    const conversationId = z
      .object({ id: z.string() })
      .parse(core.createConversation(owner, "FSM", null)).id;
    const messageId = z
      .object({ id: z.string() })
      .parse(core.createMessage(owner, conversationId, "tutor", "Original explanation")).id;
    const created = z
      .object({ item: z.object({ id: z.string() }), revision: z.object({ id: z.string() }) })
      .parse(
        new KnowledgeRepository(database).create(owner, {
          title: "FSM",
          statement: "Finite states",
          riskScope: "stable",
          confidence: 0.5,
        }),
      );
    database.close();
    const raw = new DatabaseSync(path);
    raw.exec(`DROP TABLE exposures;
      CREATE TABLE exposures(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,knowledge_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,revision INTEGER NOT NULL,message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,created_at TEXT NOT NULL);`);
    for (const [id, revision, message] of [
      ["legacy-linked", 1, messageId],
      ["legacy-source-missing", 1, null],
      ["legacy-revision-missing", 2, null],
    ] as const)
      raw
        .prepare("INSERT INTO exposures VALUES(?,?,?,?,?,?)")
        .run(id, owner, created.item.id, revision, message, "2026-09-01T00:00:00.000Z");
    raw.close();
    return {
      path,
      owner,
      knowledgeId: created.item.id,
      revisionId: created.revision.id,
      messageId,
    };
  }

  it("preserves legacy rows and never infers a generation snapshot from a message link", () => {
    // Given
    const legacy = legacyDatabase();

    // When
    const migrated = new Database(legacy.path);
    databases.push(migrated);

    // Then
    const rows = migrated.all(
      "SELECT * FROM exposures ORDER BY id",
      [],
      z.record(z.string(), z.unknown()),
    );
    expect(rows).toHaveLength(3);
    expect(rows.find((row) => row["id"] === "legacy-linked")).toMatchObject({
      learner_id: legacy.owner,
      knowledge_id: legacy.knowledgeId,
      revision: 1,
      knowledge_revision_id: legacy.revisionId,
      message_id: legacy.messageId,
      message_event_id: null,
      provenance: "legacy_unverified",
      created_at: "2026-09-01T00:00:00.000Z",
    });
    expect(rows.find((row) => row["id"] === "legacy-source-missing")).toMatchObject({
      knowledge_revision_id: legacy.revisionId,
      message_id: null,
      message_event_id: null,
      provenance: "legacy_unverified",
    });
    expect(rows.find((row) => row["id"] === "legacy-revision-missing")).toMatchObject({
      knowledge_revision_id: null,
      revision: 2,
      provenance: "legacy_unverified",
    });
    new KnowledgeRepository(migrated).rebuild(legacy.owner, legacy.knowledgeId);
    expect(
      new KnowledgeRepository(migrated).learnerState(legacy.owner, legacy.knowledgeId, 1),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          dimension: "recognition",
          status: "exposed",
          effective_evidence: 0,
        }),
      ]),
    );
  });

  it("reopens mixed records without rewriting legacy provenance when a revision subsequently appears", () => {
    // Given
    const legacy = legacyDatabase();
    const first = new Database(legacy.path);
    new KnowledgeRepository(first).addRevision(legacy.owner, {
      knowledgeId: legacy.knowledgeId,
      statement: "Revision two",
      sourceType: "learner_manual",
      sourceRef: null,
    });
    const event = z
      .object({ id: z.string() })
      .parse(
        first.raw.prepare("SELECT id FROM message_events WHERE message_id=?").get(legacy.messageId),
      );
    first.run(
      "INSERT INTO exposures(id,learner_id,knowledge_id,revision,message_id,created_at,knowledge_revision_id,message_event_id,provenance) VALUES(?,?,?,?,?,?,?,?,?)",
      [
        "new-exposure",
        legacy.owner,
        legacy.knowledgeId,
        1,
        legacy.messageId,
        "2026-09-22T00:00:00.000Z",
        legacy.revisionId,
        event.id,
        "generation_snapshot",
      ],
    );
    const before = first.all(
      "SELECT * FROM exposures ORDER BY id",
      [],
      z.record(z.string(), z.unknown()),
    );
    first.close();

    // When
    const reopened = new Database(legacy.path);
    databases.push(reopened);

    // Then
    expect(
      reopened.all("SELECT * FROM exposures ORDER BY id", [], z.record(z.string(), z.unknown())),
    ).toEqual(before);
    expect(
      before.find((row) => row["id"] === "legacy-revision-missing")?.["knowledge_revision_id"],
    ).toBeNull();
    expect(() =>
      reopened.run("UPDATE exposures SET revision=3 WHERE id='legacy-linked'"),
    ).toThrow();
    expect(() => reopened.run("DELETE FROM exposures WHERE id='legacy-linked'")).toThrow();
  });

  it("rejects a partially altered schema without adding columns or changing legacy rows", () => {
    const legacy = legacyDatabase();
    const raw = new DatabaseSync(legacy.path);
    raw.exec("ALTER TABLE exposures ADD COLUMN knowledge_revision_id TEXT");
    expect(() => new Database(legacy.path)).toThrow("Exposure provenance schema is incomplete");
    expect(raw.prepare("SELECT COUNT(*) AS count FROM exposures").get()).toEqual({ count: 3 });
    expect(
      raw.prepare("SELECT COUNT(*) AS count FROM pragma_table_info('exposures')").get(),
    ).toEqual({ count: 7 });
    raw.close();
  });

  it("does not apply an unresolved legacy exposure to a subsequently created revision", () => {
    const legacy = legacyDatabase();
    const migrated = new Database(legacy.path);
    databases.push(migrated);
    const knowledge = new KnowledgeRepository(migrated);
    knowledge.addRevision(legacy.owner, {
      knowledgeId: legacy.knowledgeId,
      statement: "A new definition with the formerly missing sequence number",
      sourceType: "learner_manual",
      sourceRef: null,
    });
    knowledge.rebuild(legacy.owner, legacy.knowledgeId);
    expect(knowledge.learnerState(legacy.owner, legacy.knowledgeId, 2)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ dimension: "recognition", status: "unknown" }),
      ]),
    );
  });
});
