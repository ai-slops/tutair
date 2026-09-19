import { createHash } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database.js";
import type { TutorProvider } from "./provider.js";
import { lexicalRanking, retrievalDocuments } from "./retrieval-documents.js";
import type { LearnerId } from "./types.js";

const embeddingRow = z.object({ vector_json: z.string() });
const vectorSchema = z.array(z.number().finite()).min(1);

function cosine(left: readonly number[], right: readonly number[]): number {
  const a = vectorSchema.parse(left);
  const b = vectorSchema.length(a.length).parse(right);
  const leftNorm = Math.hypot(...a);
  const rightNorm = Math.hypot(...b);
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0) / (leftNorm * rightNorm);
}

export async function searchKnowledge(
  db: Database,
  provider: TutorProvider,
  owner: LearnerId,
  query: string,
  limit: number,
): Promise<{
  readonly results: readonly unknown[];
  readonly mode: "hybrid" | "fts-only";
  readonly degradedReason?: string;
}> {
  const documents = retrievalDocuments(db, owner);
  const expansion = documents.filter((item) => query.includes(item.id)).map((item) => item.title);
  const expandedQuery = [query, ...expansion].join(" ");
  const lexical = lexicalRanking(db, documents, expandedQuery);
  const documentMap = new Map(documents.map((document) => [document.id, document]));
  const lexicalResults = lexical.slice(0, limit).flatMap((id, index) => {
    const document = documentMap.get(id);
    return document ? [{ ...document, score: 1 / (60 + index + 1) }] : [];
  });
  if (provider.state.embedding !== "configured" || !provider.embed) {
    return { results: lexicalResults, mode: "fts-only", degradedReason: "embedding_disabled" };
  }
  try {
    const profile = z.string().min(1).parse(provider.embeddingProfile);
    const queryVectors = await provider.embed([expandedQuery]);
    const queryVector = vectorSchema.parse(queryVectors[0]);
    const scored: { readonly id: string; readonly score: number }[] = [];
    for (const document of documents) {
      const text = `${document.title}\n${document.statement}`;
      const contentHash = createHash("sha256").update(text).digest("hex");
      const cacheProfile = `${profile}:content:${contentHash}`;
      const cached = db.one(
        "SELECT vector_json FROM embedding_cache WHERE learner_id=? AND entity_type=? AND entity_id=? AND revision=? AND model=?",
        [owner, document.entity_type, document.id, document.revision, cacheProfile],
        embeddingRow,
      );
      const vector = cached
        ? vectorSchema.parse(JSON.parse(cached.vector_json))
        : vectorSchema.parse((await provider.embed([text]))[0]);
      const score = cosine(queryVector, vector);
      if (!cached) {
        db.transaction(() => {
          db.run(
            "DELETE FROM embedding_cache WHERE learner_id=? AND entity_type=? AND entity_id=?",
            [owner, document.entity_type, document.id],
          );
          db.run("INSERT INTO embedding_cache VALUES(?,?,?,?,?,?,?,?)", [
            crypto.randomUUID(),
            owner,
            document.entity_type,
            document.id,
            document.revision,
            cacheProfile,
            JSON.stringify(vector),
            new Date().toISOString(),
          ]);
        });
      }
      if (score > 0.15) scored.push({ id: document.id, score });
    }
    const semantic = scored.sort((a, b) => b.score - a.score).map((item) => item.id);
    const ranks = new Map<string, number>();
    for (const ranking of [lexical, semantic]) {
      ranking.forEach((id, index) => {
        ranks.set(id, (ranks.get(id) ?? 0) + 1 / (60 + index + 1));
      });
    }
    const results = [...ranks]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, limit)
      .flatMap(([id, score]) => {
        const document = documentMap.get(id);
        return document ? [{ ...document, score }] : [];
      });
    return { results, mode: "hybrid" };
  } catch (error) {
    if (!(error instanceof Error)) throw error;
    return { results: lexicalResults, mode: "fts-only", degradedReason: "embedding_unavailable" };
  }
}
