import { z } from "zod";
import type { Database } from "./database.js";
import type { LearnerId } from "./types.js";

export const retrievalDocument = z.object({
  id: z.string(),
  entity_type: z.enum(["knowledge", "message", "thread", "evidence"]),
  title: z.string(),
  statement: z.string(),
  scope: z.string(),
  revision: z.number(),
});
export type RetrievalDocument = z.infer<typeof retrievalDocument>;

export function retrievalDocuments(db: Database, owner: LearnerId): readonly RetrievalDocument[] {
  return db.all(
    `SELECT k.id,'knowledge' AS entity_type,k.title,r.statement,k.scope,r.revision
     FROM knowledge_items k JOIN knowledge_revisions r
       ON r.knowledge_id=k.id AND r.revision=k.current_revision
     WHERE k.learner_id IS NULL OR k.learner_id=?
     UNION ALL
     SELECT m.id,'message','Message',m.content,'private',0 FROM messages m
       WHERE m.learner_id=? AND m.tombstoned_at IS NULL
     UNION ALL
     SELECT t.id,'thread',t.title,t.goal,'private',0 FROM threads t WHERE t.learner_id=?
     UNION ALL
     SELECT e.id,'evidence',k.title || ' / ' || e.dimension,
       r.statement || char(10) || m.content,'private',e.revision
     FROM evidence e JOIN messages m ON m.id=e.message_id
       JOIN knowledge_items k ON k.id=e.knowledge_id
       JOIN knowledge_revisions r ON r.knowledge_id=e.knowledge_id AND r.revision=e.revision
     WHERE e.learner_id=? AND m.tombstoned_at IS NULL`,
    [owner, owner, owner, owner],
    retrievalDocument,
  );
}

export function lexicalRanking(
  db: Database,
  documents: readonly RetrievalDocument[],
  query: string,
): readonly string[] {
  const tokens = query.match(/[\p{L}\p{N}_]+/gu) ?? [];
  if (tokens.length === 0 || documents.length === 0) return [];
  const expression = [...new Set(tokens)]
    .slice(0, 40)
    .map((token) => `"${token}"`)
    .join(" OR ");
  // Query-local indexing keeps other learners out of BM25 corpus statistics and leaves no PII index.
  db.raw.exec(
    "CREATE VIRTUAL TABLE temp.tutor_search_fts USING fts5(id UNINDEXED,title,statement,tokenize='porter unicode61')",
  );
  try {
    db.transaction(() => {
      for (const document of documents) {
        db.run("INSERT INTO temp.tutor_search_fts VALUES(?,?,?)", [
          document.id,
          document.title,
          document.statement,
        ]);
      }
    });
    return db
      .all(
        "SELECT id FROM temp.tutor_search_fts WHERE tutor_search_fts MATCH ? ORDER BY bm25(tutor_search_fts),id",
        [expression],
        z.object({ id: z.string() }),
      )
      .map((row) => row.id);
  } finally {
    db.raw.exec("DROP TABLE temp.tutor_search_fts");
  }
}
