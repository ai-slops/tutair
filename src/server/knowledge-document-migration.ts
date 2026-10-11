import { createHash, randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";

const legacyRevision = z.object({
  id: z.string(),
  knowledge_id: z.string(),
  learner_id: z.string().nullable(),
  statement: z.string(),
  source_type: z.string(),
  source_ref: z.string().nullable(),
  model_run_id: z.string().nullable(),
  created_at: z.string(),
});

export function migrateKnowledgeDocuments(raw: DatabaseSync): void {
  raw.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_documents(
      id TEXT PRIMARY KEY,
      owner_learner_id TEXT REFERENCES learners(id) ON DELETE CASCADE,
      knowledge_revision_id TEXT NOT NULL REFERENCES knowledge_revisions(id) ON DELETE CASCADE,
      role TEXT NOT NULL CHECK(role IN('english_base','localization','legacy')),
      language_tag TEXT NOT NULL,
      version INTEGER NOT NULL CHECK(version>0),
      base_document_id TEXT REFERENCES knowledge_documents(id),
      supersedes_document_id TEXT REFERENCES knowledge_documents(id),
      source_type TEXT NOT NULL,
      model_run_id TEXT REFERENCES model_runs(id) ON DELETE SET NULL,
      source_refs_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(owner_learner_id,knowledge_revision_id,role,language_tag,version)
    );
    CREATE TABLE IF NOT EXISTS knowledge_document_blocks(
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL REFERENCES knowledge_documents(id) ON DELETE CASCADE,
      position INTEGER NOT NULL CHECK(position>=0),
      block_type TEXT NOT NULL CHECK(block_type IN('definition','scope','feature','claim','example','contrast','prerequisite','caveat','procedure_step')),
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      source_block_id TEXT REFERENCES knowledge_document_blocks(id),
      UNIQUE(document_id,position)
    );
    CREATE TABLE IF NOT EXISTS knowledge_document_block_topics(
      block_id TEXT NOT NULL REFERENCES knowledge_document_blocks(id) ON DELETE CASCADE,
      knowledge_revision_id TEXT NOT NULL REFERENCES knowledge_revisions(id),
      PRIMARY KEY(block_id,knowledge_revision_id)
    );
    CREATE INDEX IF NOT EXISTS knowledge_documents_revision
      ON knowledge_documents(knowledge_revision_id,role,language_tag,version);
    CREATE TRIGGER IF NOT EXISTS immutable_knowledge_documents_update
      BEFORE UPDATE ON knowledge_documents BEGIN SELECT RAISE(ABORT,'knowledge documents are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_knowledge_document_blocks_update
      BEFORE UPDATE ON knowledge_document_blocks BEGIN SELECT RAISE(ABORT,'knowledge document blocks are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_knowledge_document_topics_update
      BEFORE UPDATE ON knowledge_document_block_topics BEGIN SELECT RAISE(ABORT,'knowledge document topics are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_knowledge_documents_delete
      BEFORE DELETE ON knowledge_documents WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0
      BEGIN SELECT RAISE(ABORT,'knowledge documents are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_knowledge_document_blocks_delete
      BEFORE DELETE ON knowledge_document_blocks WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0
      BEGIN SELECT RAISE(ABORT,'knowledge document blocks are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_knowledge_document_topics_delete
      BEFORE DELETE ON knowledge_document_block_topics WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0
      BEGIN SELECT RAISE(ABORT,'knowledge document topics are immutable'); END;
  `);
  migrateLegacyDocuments(raw);
}

export function migrateLegacyDocuments(raw: DatabaseSync): void {
  const rows = z.array(legacyRevision).parse(
    raw
      .prepare(
        `SELECT r.id,r.knowledge_id,k.learner_id,r.statement,r.source_type,r.source_ref,
         r.model_run_id,r.created_at FROM knowledge_revisions r
         JOIN knowledge_items k ON k.id=r.knowledge_id
         WHERE NOT EXISTS(SELECT 1 FROM knowledge_documents d
           WHERE d.knowledge_revision_id=r.id AND d.role='legacy')`,
      )
      .all(),
  );
  for (const row of rows) {
    const documentId = randomUUID();
    const blockId = randomUUID();
    raw
      .prepare("INSERT INTO knowledge_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(
        documentId,
        row.learner_id,
        row.id,
        "legacy",
        "und",
        1,
        null,
        null,
        row.source_type,
        row.model_run_id,
        JSON.stringify(row.source_ref === null ? [] : [row.source_ref]),
        row.created_at,
      );
    raw
      .prepare("INSERT INTO knowledge_document_blocks VALUES(?,?,?,?,?,?,?)")
      .run(
        blockId,
        documentId,
        0,
        "definition",
        row.statement,
        createHash("sha256").update(row.statement).digest("hex"),
        null,
      );
    raw.prepare("INSERT INTO knowledge_document_block_topics VALUES(?,?)").run(blockId, row.id);
  }
}
