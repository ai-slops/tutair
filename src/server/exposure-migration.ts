import type { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { ApiError } from "./types.js";

export function migrateExposures(raw: DatabaseSync): void {
  raw.exec("BEGIN IMMEDIATE");
  try {
    const { count } = z
      .object({ count: z.number() })
      .parse(
        raw
          .prepare(
            "SELECT COUNT(*) AS count FROM pragma_table_info('exposures') WHERE name IN ('knowledge_revision_id','message_event_id','provenance')",
          )
          .get(),
      );
    if (count !== 0 && count !== 3)
      throw new ApiError(
        500,
        "exposure_schema_partial",
        "Exposure provenance schema is incomplete",
      );
    if (count === 0) {
      raw.exec(`
        ALTER TABLE exposures ADD COLUMN knowledge_revision_id TEXT REFERENCES knowledge_revisions(id) ON DELETE CASCADE;
        ALTER TABLE exposures ADD COLUMN message_event_id TEXT REFERENCES message_events(id) ON DELETE CASCADE;
        ALTER TABLE exposures ADD COLUMN provenance TEXT NOT NULL DEFAULT 'legacy_unverified'
          CHECK(provenance IN ('legacy_unverified','generation_snapshot'));
        UPDATE exposures SET knowledge_revision_id=(
          SELECT r.id FROM knowledge_revisions r JOIN knowledge_items k ON k.id=r.knowledge_id
          WHERE r.knowledge_id=exposures.knowledge_id AND r.revision=exposures.revision
            AND (k.learner_id IS NULL OR k.learner_id=exposures.learner_id)
        );
      `);
    }
    raw.exec(`
      CREATE TRIGGER IF NOT EXISTS exposure_provenance_insert BEFORE INSERT ON exposures
      WHEN NEW.provenance<>'generation_snapshot'
        OR EXISTS (SELECT 1 FROM exposures WHERE id=NEW.id)
        OR NEW.knowledge_revision_id IS NULL OR NEW.message_event_id IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM knowledge_revisions r JOIN knowledge_items k ON k.id=r.knowledge_id
          WHERE r.id=NEW.knowledge_revision_id AND r.knowledge_id=NEW.knowledge_id
            AND r.revision=NEW.revision AND (k.learner_id IS NULL OR k.learner_id=NEW.learner_id)
        )
        OR NOT EXISTS (
          SELECT 1 FROM message_events e JOIN messages m ON m.id=e.message_id
          WHERE e.id=NEW.message_event_id AND e.message_id=NEW.message_id
            AND e.learner_id=NEW.learner_id AND m.learner_id=NEW.learner_id
            AND e.event_type='created' AND e.content IS NOT NULL AND m.role='tutor'
        )
      BEGIN SELECT RAISE(ABORT,'invalid exposure provenance'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_exposures_update BEFORE UPDATE ON exposures
      BEGIN SELECT RAISE(ABORT,'exposures are immutable'); END;
      CREATE TRIGGER IF NOT EXISTS immutable_exposures_delete BEFORE DELETE ON exposures
      WHEN COALESCE((SELECT active FROM privacy_mode WHERE singleton=1),0)<>1
      BEGIN SELECT RAISE(ABORT,'exposures are immutable'); END;
    `);
    raw.exec("COMMIT");
  } catch (error) {
    raw.exec("ROLLBACK");
    throw error;
  }
}
