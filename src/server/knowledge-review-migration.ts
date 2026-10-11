import type { DatabaseSync } from "node:sqlite";

export const migrateKnowledgeReviews = (raw: DatabaseSync): void => {
  const nested = raw.isTransaction;
  raw.exec(nested ? "SAVEPOINT migrate_knowledge_reviews" : "BEGIN IMMEDIATE");
  try {
    raw.exec(`
      CREATE TABLE IF NOT EXISTS knowledge_review_events(
        id TEXT PRIMARY KEY,
        learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,
        knowledge_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,
        knowledge_revision_id TEXT NOT NULL REFERENCES knowledge_revisions(id),
        revision INTEGER NOT NULL,
        action TEXT NOT NULL CHECK(action IN('reviewed','mark_incorrect','retire','restore')),
        reason TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS knowledge_review_events_projection
        ON knowledge_review_events(learner_id,knowledge_id,revision,created_at);
      CREATE TRIGGER IF NOT EXISTS immutable_knowledge_review_events_update
        BEFORE UPDATE ON knowledge_review_events BEGIN
          SELECT RAISE(ABORT,'knowledge review events are immutable');
        END;
      CREATE TRIGGER IF NOT EXISTS immutable_knowledge_review_events_delete
        BEFORE DELETE ON knowledge_review_events
        WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN
          SELECT RAISE(ABORT,'knowledge review events are immutable');
        END;
    `);
    raw.exec(nested ? "RELEASE SAVEPOINT migrate_knowledge_reviews" : "COMMIT");
  } catch (error) {
    raw.exec(
      nested
        ? "ROLLBACK TO SAVEPOINT migrate_knowledge_reviews; RELEASE SAVEPOINT migrate_knowledge_reviews"
        : "ROLLBACK",
    );
    throw error;
  }
};
