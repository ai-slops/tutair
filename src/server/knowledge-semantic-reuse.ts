import { z } from "zod";
import type { Database } from "./database.js";
import { knowledgeScopeFingerprint, migrateRevisionMetadata } from "./knowledge-contracts.js";
import type { NewKnowledge } from "./knowledge-inputs.js";
import { eligibleKnowledgeIds } from "./knowledge-review.js";
import { knowledgeRecord, revisionRecord } from "./records.js";
import type { LearnerId } from "./types.js";

const semanticCandidate = z.object({
  knowledge_id: z.string(),
  revision_id: z.string(),
  contract_json: z.string().nullable(),
});

const normalizedText = (value: string): string =>
  value.normalize("NFKC").trim().replace(/\s+/gu, " ").toLocaleLowerCase();

export function exactGeneratedKnowledge(
  db: Database,
  owner: LearnerId,
  input: NewKnowledge,
  expectedContractJson?: string,
): { readonly item: unknown; readonly revision: unknown } | null {
  const rows = db.all(
    `SELECT k.id AS knowledge_id,r.id AS revision_id,c.contract_json
     FROM knowledge_items k JOIN knowledge_revisions r
       ON r.knowledge_id=k.id AND r.revision=k.current_revision
     LEFT JOIN typed_knowledge_contracts c ON c.knowledge_revision_id=r.id
     WHERE k.learner_id=? ORDER BY k.created_at,k.id`,
    [owner],
    semanticCandidate,
  );
  const eligible = new Set(
    eligibleKnowledgeIds(
      db,
      owner,
      rows.map((row) => row.knowledge_id),
    ),
  );
  const inputLabels = new Set([input.title, ...(input.aliases ?? [])].map(normalizedText));
  for (const row of rows) {
    if (!eligible.has(row.knowledge_id)) continue;
    if (expectedContractJson !== undefined && row.contract_json !== expectedContractJson) continue;
    const item = knowledgeRecord.parse(
      db.one(
        "SELECT * FROM knowledge_items WHERE id=? AND learner_id=?",
        [row.knowledge_id, owner],
        knowledgeRecord,
      ),
    );
    const revision = revisionRecord.parse(
      db.one("SELECT * FROM knowledge_revisions WHERE id=?", [row.revision_id], revisionRecord),
    );
    const metadata = migrateRevisionMetadata(revision);
    const labels = [item.title, ...z.array(z.string()).parse(JSON.parse(item.aliases_json))];
    if (
      item.kind === (input.kind ?? "claim") &&
      knowledgeScopeFingerprint(metadata.semanticScope, metadata.definitionScope) ===
        knowledgeScopeFingerprint(input.semanticScope ?? "", input.definitionScope) &&
      normalizedText(revision.statement) === normalizedText(input.statement) &&
      labels.some((label) => inputLabels.has(normalizedText(label)))
    )
      return { item, revision };
  }
  return null;
}
