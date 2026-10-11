import { z } from "zod";
import type { Database } from "./database.js";
import { eligibleKnowledgeIds } from "./knowledge-review.js";
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
  const eligible = eligibleKnowledgeIds(
    db,
    owner,
    db
      .all(
        "SELECT id FROM knowledge_items WHERE learner_id IS NULL OR learner_id=?",
        [owner],
        z.object({ id: z.string() }),
      )
      .map((row) => row.id),
  );
  const clause = eligible.length === 0 ? "0" : `k.id IN (${eligible.map(() => "?").join(",")})`;
  const knowledge = db.all(
    `SELECT k.id,'knowledge' AS entity_type,k.title,
       r.statement || char(10) || COALESCE(k.aliases_json,'[]') || char(10) ||
       COALESCE(group_concat(b.content,char(10)),'') AS statement,
       k.scope,r.revision
     FROM knowledge_items k
     JOIN knowledge_revisions r ON r.knowledge_id=k.id AND r.revision=k.current_revision
     LEFT JOIN knowledge_documents d ON d.knowledge_revision_id=r.id
       AND (d.owner_learner_id=? OR (d.owner_learner_id IS NULL AND k.learner_id IS NULL))
       AND NOT EXISTS (
         SELECT 1 FROM knowledge_documents newer
         WHERE newer.knowledge_revision_id=d.knowledge_revision_id
           AND newer.owner_learner_id IS d.owner_learner_id
           AND newer.role=d.role AND newer.language_tag=d.language_tag
           AND newer.version>d.version
       )
       AND (d.role<>'localization' OR d.base_document_id=(
         SELECT base.id FROM knowledge_documents base
         WHERE base.knowledge_revision_id=r.id AND base.role='english_base'
           AND (base.owner_learner_id=? OR (base.owner_learner_id IS NULL AND k.learner_id IS NULL))
         ORDER BY CASE WHEN base.owner_learner_id IS NULL THEN 0 ELSE 1 END,base.version DESC LIMIT 1
       ))
     LEFT JOIN knowledge_document_blocks b ON b.document_id=d.id
     WHERE (k.learner_id IS NULL OR k.learner_id=?) AND ${clause}
     GROUP BY k.id,k.title,r.statement,k.aliases_json,k.scope,r.revision`,
    [owner, owner, owner, ...eligible],
    retrievalDocument,
  );
  const privateRecords = db.all(
    `SELECT m.id,'message' AS entity_type,'Message' AS title,m.content AS statement,'private' AS scope,0 AS revision FROM messages m
       WHERE m.learner_id=? AND m.tombstoned_at IS NULL
     UNION ALL
      SELECT t.id,'thread',t.title,t.goal || char(10) || t.desired_outcome || char(10) || COALESCE(t.why_now,''),'private',0 FROM threads t WHERE t.learner_id=?
     UNION ALL
     SELECT e.id,'evidence',k.title || ' / ' || e.dimension,
       r.statement || char(10) || m.content,'private',e.revision
     FROM evidence e JOIN messages m ON m.id=e.message_id
       JOIN knowledge_items k ON k.id=e.knowledge_id
       JOIN knowledge_revisions r ON r.knowledge_id=e.knowledge_id AND r.revision=e.revision
     WHERE e.learner_id=? AND m.tombstoned_at IS NULL AND ${clause}`,
    [owner, owner, owner, ...eligible],
    retrievalDocument,
  );
  return [...knowledge, ...privateRecords];
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
    return [
      ...new Set(
        db
          .all(
            "SELECT id FROM temp.tutor_search_fts WHERE tutor_search_fts MATCH ? ORDER BY bm25(tutor_search_fts),id",
            [expression],
            z.object({ id: z.string() }),
          )
          .map((row) => row.id),
      ),
    ];
  } finally {
    db.raw.exec("DROP TABLE temp.tutor_search_fts");
  }
}
