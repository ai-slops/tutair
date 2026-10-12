import type { DatabaseSync } from "node:sqlite";

export function migrateMisconceptions(database: DatabaseSync): void {
  database.exec(`
    CREATE TABLE IF NOT EXISTS misconceptions(
      id TEXT PRIMARY KEY,
      learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
      fingerprint TEXT NOT NULL,
      current_revision INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      UNIQUE(learner_id,fingerprint)
    );
    CREATE TABLE IF NOT EXISTS misconception_revisions(
      id TEXT PRIMARY KEY,
      misconception_id TEXT NOT NULL REFERENCES misconceptions(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      label TEXT NOT NULL,
      mistaken_proposition TEXT NOT NULL,
      correction TEXT NOT NULL,
      failure_task TEXT NOT NULL,
      likely_error TEXT NOT NULL,
      discriminating_example_json TEXT NOT NULL,
      reuse_value_reason TEXT NOT NULL,
      source_refs_json TEXT NOT NULL,
      source_type TEXT NOT NULL,
      extraction_run_id TEXT,
      resolution_run_id TEXT,
      model_review_json TEXT,
      created_at TEXT NOT NULL,
      UNIQUE(misconception_id,revision)
    );
    CREATE TABLE IF NOT EXISTS misconception_definition_links(
      misconception_revision_id TEXT NOT NULL REFERENCES misconception_revisions(id) ON DELETE CASCADE,
      definition_revision_id TEXT NOT NULL REFERENCES knowledge_revisions(id),
      role TEXT NOT NULL CHECK(role IN('subject','contrast','correction_basis')),
      learning_value TEXT NOT NULL,
      PRIMARY KEY(misconception_revision_id,definition_revision_id)
    );
    CREATE TABLE IF NOT EXISTS misconception_blocks(
      id TEXT PRIMARY KEY,
      misconception_revision_id TEXT NOT NULL REFERENCES misconception_revisions(id) ON DELETE CASCADE,
      position INTEGER NOT NULL,
      block_type TEXT NOT NULL CHECK(block_type IN('misconception','correction','failure_task','likely_error','example')),
      content TEXT NOT NULL,
      content_hash TEXT NOT NULL,
      language_tag TEXT NOT NULL,
      source_english_block_id TEXT REFERENCES misconception_blocks(id),
      anchor_definition_revision_id TEXT NOT NULL REFERENCES knowledge_revisions(id),
      UNIQUE(misconception_revision_id,language_tag,position)
    );
    CREATE TABLE IF NOT EXISTS misconception_review_events(
      id TEXT PRIMARY KEY,
      misconception_id TEXT NOT NULL REFERENCES misconceptions(id) ON DELETE CASCADE,
      misconception_revision_id TEXT NOT NULL REFERENCES misconception_revisions(id),
      learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
      action TEXT NOT NULL CHECK(action IN('reviewed','mark_incorrect','retire','restore')),
      reason TEXT,
      created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS typed_knowledge_contracts(
      knowledge_revision_id TEXT PRIMARY KEY REFERENCES knowledge_revisions(id) ON DELETE CASCADE,
      artifact_type TEXT NOT NULL CHECK(artifact_type IN('definition','claim','distinction')),
      contract_json TEXT NOT NULL,
      extraction_run_id TEXT NOT NULL,
      resolution_run_id TEXT NOT NULL,
      model_review_json TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS misconception_owner ON misconceptions(learner_id,created_at);
    CREATE INDEX IF NOT EXISTS misconception_review_owner ON misconception_review_events(learner_id,misconception_id,created_at);
    CREATE TRIGGER IF NOT EXISTS immutable_misconception_revisions_update BEFORE UPDATE ON misconception_revisions BEGIN SELECT RAISE(ABORT,'misconception revisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_misconception_links_update BEFORE UPDATE ON misconception_definition_links BEGIN SELECT RAISE(ABORT,'misconception links are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_misconception_blocks_update BEFORE UPDATE ON misconception_blocks BEGIN SELECT RAISE(ABORT,'misconception blocks are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_misconception_reviews_update BEFORE UPDATE ON misconception_review_events BEGIN SELECT RAISE(ABORT,'misconception review events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_typed_knowledge_contracts_update BEFORE UPDATE ON typed_knowledge_contracts BEGIN SELECT RAISE(ABORT,'typed knowledge contracts are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_misconception_revisions_delete BEFORE DELETE ON misconception_revisions WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN SELECT RAISE(ABORT,'misconception revisions are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_misconception_links_delete BEFORE DELETE ON misconception_definition_links WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN SELECT RAISE(ABORT,'misconception links are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_misconception_blocks_delete BEFORE DELETE ON misconception_blocks WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN SELECT RAISE(ABORT,'misconception blocks are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_misconception_reviews_delete BEFORE DELETE ON misconception_review_events WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN SELECT RAISE(ABORT,'misconception review events are immutable'); END;
    CREATE TRIGGER IF NOT EXISTS immutable_typed_knowledge_contracts_delete BEFORE DELETE ON typed_knowledge_contracts WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN SELECT RAISE(ABORT,'typed knowledge contracts are immutable'); END;
  `);
}
