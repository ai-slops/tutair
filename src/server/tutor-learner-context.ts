import { z } from "zod";
import type { Database } from "./database.js";
import type { LearnerId } from "./types.js";

const stateRecord = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

function boundedRecords(
  records: readonly z.infer<typeof stateRecord>[],
  maxPerUnit: number,
  characterBudget: number,
): readonly z.infer<typeof stateRecord>[] {
  const counts = new Map<string, number>();
  const selected: z.infer<typeof stateRecord>[] = [];
  let characters = 0;
  for (const record of records) {
    const knowledgeId = record["knowledge_id"];
    if (typeof knowledgeId !== "string") continue;
    const count = counts.get(knowledgeId) ?? 0;
    const size = JSON.stringify(record).length;
    if (count >= maxPerUnit || characters + size > characterBudget) continue;
    counts.set(knowledgeId, count + 1);
    selected.push(record);
    characters += size;
  }
  return selected;
}

export function loadLearnerContext(db: Database, owner: LearnerId, ids: readonly string[]) {
  if (ids.length === 0) return { learnerStates: [], supportingEvidence: [] };
  const placeholders = ids.map(() => "?").join(",");
  return {
    learnerStates: boundedRecords(
      db.all(
        `SELECT s.* FROM learner_state s
         JOIN knowledge_items k ON k.id=s.knowledge_id AND k.current_revision=s.revision
         WHERE s.learner_id=? AND s.knowledge_id IN (${placeholders})
         ORDER BY s.projected_at DESC,s.knowledge_id,s.dimension`,
        [owner, ...ids],
        stateRecord,
      ),
      6,
      12_000,
    ),
    supportingEvidence: boundedRecords(
      db.all(
        `SELECT e.* FROM evidence e
         JOIN knowledge_items k ON k.id=e.knowledge_id AND k.current_revision=e.revision
         WHERE e.learner_id=? AND e.knowledge_id IN (${placeholders})
         ORDER BY e.created_at DESC,e.id`,
        [owner, ...ids],
        stateRecord,
      ),
      4,
      16_000,
    ),
  };
}
