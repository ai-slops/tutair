import { z } from "zod";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import { knowledgeContext } from "./tutor-knowledge.js";
import { loadLearnerContext } from "./tutor-learner-context.js";
import type { LearnerId } from "./types.js";

export function loadTurnKnowledge(
  repository: KnowledgeRepository,
  owner: LearnerId,
  ids: readonly string[],
) {
  for (const id of ids) repository.rebuild(owner, id);
  const placeholders = ids.map(() => "?").join(",");
  return {
    knowledge: knowledgeContext(repository, owner, ids),
    ...loadLearnerContext(repository.db, owner, ids),
    relations:
      ids.length === 0
        ? []
        : repository.db.all(
            `SELECT * FROM knowledge_relations WHERE (learner_id IS NULL OR learner_id=?)
       AND from_knowledge_id IN (${placeholders}) AND to_knowledge_id IN (${placeholders})
       ORDER BY created_at DESC,id LIMIT 48`,
            [owner, ...ids, ...ids],
            z.record(z.string(), z.union([z.string(), z.number(), z.null()])),
          ),
  };
}
