import { DatabaseSync } from "node:sqlite";
import { z } from "zod";
import { projectionVersion } from "./learner-projection.js";

const migrations = `
PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS privacy_mode(singleton INTEGER PRIMARY KEY CHECK(singleton=1),active INTEGER NOT NULL CHECK(active IN(0,1))); INSERT OR IGNORE INTO privacy_mode VALUES(1,0);
CREATE TABLE IF NOT EXISTS learners(id TEXT PRIMARY KEY,display_name TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,token_hash TEXT UNIQUE NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS conversations(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,title TEXT NOT NULL,goal TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,role TEXT NOT NULL CHECK(role IN('learner','tutor')),content TEXT NOT NULL,synthetic INTEGER NOT NULL DEFAULT 0,tombstoned_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS message_events(id TEXT PRIMARY KEY,message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,learner_id TEXT NOT NULL,event_type TEXT NOT NULL,prior_content TEXT,content TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS threads(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,title TEXT NOT NULL,goal TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS thread_conversations(thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,linked_at TEXT NOT NULL,PRIMARY KEY(thread_id,conversation_id));
CREATE TABLE IF NOT EXISTS thread_events(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,learner_id TEXT NOT NULL,event_type TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS open_questions(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES threads(id) ON DELETE CASCADE,learner_id TEXT NOT NULL,question TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS knowledge_items(id TEXT PRIMARY KEY,learner_id TEXT,canonical_key TEXT,scope TEXT NOT NULL,risk_scope TEXT NOT NULL,title TEXT NOT NULL,kind TEXT NOT NULL,aliases_json TEXT NOT NULL,current_revision INTEGER NOT NULL,mastery REAL NOT NULL DEFAULT 0,confidence REAL NOT NULL DEFAULT 0,created_at TEXT NOT NULL,UNIQUE(learner_id,canonical_key));
CREATE TABLE IF NOT EXISTS knowledge_revisions(id TEXT PRIMARY KEY,knowledge_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,revision INTEGER NOT NULL,statement TEXT NOT NULL,semantic_scope TEXT NOT NULL,distinguishing_features_json TEXT NOT NULL,claims_json TEXT NOT NULL,source_refs_json TEXT NOT NULL,source_type TEXT NOT NULL,source_ref TEXT,model_run_id TEXT,conversation_id TEXT,source_message_ids_json TEXT NOT NULL,source_message_event_ids_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(knowledge_id,revision));
CREATE TABLE IF NOT EXISTS knowledge_relations(id TEXT PRIMARY KEY,learner_id TEXT REFERENCES learners(id) ON DELETE CASCADE,from_knowledge_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,to_knowledge_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,kind TEXT NOT NULL,from_revision_id TEXT NOT NULL REFERENCES knowledge_revisions(id),to_revision_id TEXT NOT NULL REFERENCES knowledge_revisions(id),necessity TEXT,scaffoldable INTEGER,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS assessments(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evidence(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,knowledge_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,knowledge_revision_id TEXT NOT NULL REFERENCES knowledge_revisions(id),revision INTEGER NOT NULL,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,message_id TEXT NOT NULL REFERENCES messages(id) ON DELETE CASCADE,message_event_id TEXT NOT NULL REFERENCES message_events(id),assessment_id TEXT REFERENCES assessments(id) ON DELETE SET NULL,dimension TEXT NOT NULL,evidence_type TEXT NOT NULL,score REAL NOT NULL,polarity TEXT NOT NULL,strength REAL NOT NULL,evaluator_confidence REAL NOT NULL,evaluator_type TEXT NOT NULL,evaluator_model_run_id TEXT REFERENCES model_runs(id) ON DELETE SET NULL,rubric_version TEXT NOT NULL,hints INTEGER NOT NULL,answer_visible INTEGER NOT NULL,open_book INTEGER NOT NULL,copied_from_recent_context INTEGER NOT NULL,supporting_spans_json TEXT NOT NULL,limitations_json TEXT NOT NULL,related_unit_ids_json TEXT NOT NULL,thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,difficulty REAL,context_discount REAL NOT NULL DEFAULT 1,weight REAL NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS exposures(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,knowledge_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,revision INTEGER NOT NULL,message_id TEXT REFERENCES messages(id) ON DELETE CASCADE,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS corrections(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,knowledge_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,correction_type TEXT NOT NULL,target_type TEXT NOT NULL,target_id TEXT NOT NULL,from_revision_id TEXT NOT NULL REFERENCES knowledge_revisions(id),to_revision_id TEXT NOT NULL REFERENCES knowledge_revisions(id),statement TEXT NOT NULL,reason TEXT NOT NULL,source_message_id TEXT REFERENCES messages(id) ON DELETE SET NULL,source_message_event_id TEXT REFERENCES message_events(id),created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS evidence_invalidations(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,evidence_id TEXT NOT NULL REFERENCES evidence(id) ON DELETE CASCADE,correction_id TEXT NOT NULL REFERENCES corrections(id) ON DELETE CASCADE,created_at TEXT NOT NULL,UNIQUE(learner_id,evidence_id));
CREATE TABLE IF NOT EXISTS model_runs(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,conversation_id TEXT,stage TEXT NOT NULL,version TEXT NOT NULL,provider TEXT NOT NULL,status TEXT NOT NULL,input_message_id TEXT,output_message_id TEXT,error_code TEXT,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS model_run_details(run_id TEXT PRIMARY KEY REFERENCES model_runs(id) ON DELETE CASCADE,model TEXT,purpose TEXT NOT NULL,prompt_version TEXT NOT NULL,schema_version TEXT NOT NULL,input_hash TEXT NOT NULL,output_json TEXT,usage_json TEXT,latency_ms INTEGER,fallback_status TEXT);
CREATE TABLE IF NOT EXISTS traces(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,run_id TEXT REFERENCES model_runs(id) ON DELETE CASCADE,event TEXT NOT NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS turn_plans(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,thread_id TEXT REFERENCES threads(id) ON DELETE SET NULL,model_run_id TEXT REFERENCES model_runs(id) ON DELETE SET NULL,data_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS embeddings(id TEXT PRIMARY KEY,learner_id TEXT,knowledge_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,revision INTEGER NOT NULL,model TEXT NOT NULL,vector_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS embedding_cache(id TEXT PRIMARY KEY,learner_id TEXT,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,revision INTEGER NOT NULL,model TEXT NOT NULL,vector_json TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(learner_id,entity_type,entity_id,revision,model));
CREATE TABLE IF NOT EXISTS learner_state(id TEXT PRIMARY KEY,learner_id TEXT NOT NULL REFERENCES learners(id) ON DELETE CASCADE,knowledge_id TEXT NOT NULL REFERENCES knowledge_items(id) ON DELETE CASCADE,knowledge_revision_id TEXT REFERENCES knowledge_revisions(id),revision INTEGER NOT NULL,dimension TEXT NOT NULL,estimate REAL NOT NULL,uncertainty REAL NOT NULL,status TEXT NOT NULL,effective_evidence REAL NOT NULL,last_observation TEXT,evidence_ids_json TEXT NOT NULL DEFAULT '[]',projection_version TEXT NOT NULL,projected_at TEXT NOT NULL,UNIQUE(learner_id,knowledge_id,revision,dimension));
CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_fts USING fts5(knowledge_id UNINDEXED,title,statement);
CREATE INDEX IF NOT EXISTS messages_owner ON messages(learner_id,conversation_id); CREATE INDEX IF NOT EXISTS evidence_owner ON evidence(learner_id,knowledge_id,revision);
CREATE TRIGGER IF NOT EXISTS immutable_message_events_update BEFORE UPDATE ON message_events BEGIN SELECT RAISE(ABORT,'message events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_thread_events_update BEFORE UPDATE ON thread_events BEGIN SELECT RAISE(ABORT,'thread events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_thread_conversations_update BEFORE UPDATE ON thread_conversations BEGIN SELECT RAISE(ABORT,'thread conversation links are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_revisions_update BEFORE UPDATE ON knowledge_revisions BEGIN SELECT RAISE(ABORT,'knowledge revisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_evidence_update BEFORE UPDATE ON evidence BEGIN SELECT RAISE(ABORT,'evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_corrections_update BEFORE UPDATE ON corrections BEGIN SELECT RAISE(ABORT,'corrections are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_relations_update BEFORE UPDATE ON knowledge_relations BEGIN SELECT RAISE(ABORT,'knowledge relations are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_message_events_delete BEFORE DELETE ON message_events WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN SELECT RAISE(ABORT,'message events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_thread_events_delete BEFORE DELETE ON thread_events WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN SELECT RAISE(ABORT,'thread events are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_thread_conversations_delete BEFORE DELETE ON thread_conversations WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN SELECT RAISE(ABORT,'thread conversation links are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_revisions_delete BEFORE DELETE ON knowledge_revisions WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN SELECT RAISE(ABORT,'knowledge revisions are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_evidence_delete BEFORE DELETE ON evidence WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN SELECT RAISE(ABORT,'evidence is immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_corrections_delete BEFORE DELETE ON corrections WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN SELECT RAISE(ABORT,'corrections are immutable'); END;
CREATE TRIGGER IF NOT EXISTS immutable_relations_delete BEFORE DELETE ON knowledge_relations WHEN (SELECT active FROM privacy_mode WHERE singleton=1)=0 BEGIN SELECT RAISE(ABORT,'knowledge relations are immutable'); END;
`;

const columnCountRecord = z.object({ count: z.number() });

const addLearnerStateColumn = (raw: DatabaseSync, name: string, definition: string): void => {
  const row = columnCountRecord.parse(
    raw
      .prepare("SELECT COUNT(*) AS count FROM pragma_table_info('learner_state') WHERE name=?")
      .get(name),
  );
  if (row.count === 0) raw.exec(`ALTER TABLE learner_state ADD COLUMN ${name} ${definition}`);
};

const migrateLearnerState = (raw: DatabaseSync): void => {
  addLearnerStateColumn(raw, "knowledge_revision_id", "TEXT REFERENCES knowledge_revisions(id)");
  addLearnerStateColumn(raw, "evidence_ids_json", "TEXT NOT NULL DEFAULT '[]'");
  addLearnerStateColumn(raw, "projection_version", `TEXT NOT NULL DEFAULT '${projectionVersion}'`);
  raw
    .prepare(
      "UPDATE learner_state SET knowledge_revision_id=(SELECT id FROM knowledge_revisions WHERE knowledge_id=learner_state.knowledge_id AND revision=learner_state.revision) WHERE knowledge_revision_id IS NULL",
    )
    .run();
};

export type SqlValue = string | number | null;

export class Database {
  readonly raw: DatabaseSync;
  constructor(path: string) {
    this.raw = new DatabaseSync(path);
    this.raw.exec(migrations);
    migrateLearnerState(this.raw);
  }
  run(sql: string, values: readonly SqlValue[] = []): void {
    this.raw.prepare(sql).run(...values);
  }
  one<T>(sql: string, values: readonly SqlValue[], schema: z.ZodType<T>): T | null {
    const row: unknown = this.raw.prepare(sql).get(...values);
    return row === undefined ? null : schema.parse(row);
  }
  all<T>(sql: string, values: readonly SqlValue[], schema: z.ZodType<T>): readonly T[] {
    const rows: unknown[] = this.raw.prepare(sql).all(...values);
    return rows.map((row) => schema.parse(row));
  }
  transaction<T>(work: () => T): T {
    if (this.raw.isTransaction) return work();
    this.raw.exec("BEGIN IMMEDIATE");
    try {
      const result = work();
      this.raw.exec("COMMIT");
      return result;
    } catch (error) {
      this.raw.exec("ROLLBACK");
      throw error;
    }
  }
  close(): void {
    this.raw.close();
  }
}
