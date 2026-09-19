import { z } from "zod";
import type { Database } from "./database.js";
import { messageRecord } from "./records.js";
import type { CoreRepository } from "./repository-core.js";
import { retrievalDocument } from "./retrieval-documents.js";
import type { TurnInput } from "./tutor-schemas.js";

const conversationGoal = z.object({ goal: z.string().nullable() });
const stateRecord = z.record(z.string(), z.union([z.string(), z.number(), z.null()]));

export type TutorContext = {
  readonly currentGoal: string;
  readonly threadId: string | null;
  readonly selectedKnowledgeIds: readonly string[];
  readonly recentContext: readonly z.infer<typeof messageRecord>[];
  readonly tutorTexts: readonly string[];
  readonly relations: readonly unknown[];
  readonly learnerStates: readonly unknown[];
  readonly supportingEvidence: readonly unknown[];
  readonly openQuestions: readonly unknown[];
};

const knowledgeIdRecord = z.object({ knowledge_id: z.string() });
const threadPlanRecord = z.object({ data_json: z.string() });
const plannedUnitIds = z.object({
  targetUnits: z.array(z.string()),
  assumedUnits: z.array(z.string()),
  introducedUnits: z.array(z.string()),
  deferredUnits: z.array(z.string()),
});
const relationRecord = z.object({
  id: z.string(),
  from_knowledge_id: z.string(),
  to_knowledge_id: z.string(),
  kind: z.string(),
  necessity: z.string().nullable(),
  scaffoldable: z.number().nullable(),
});

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

export function loadTutorContext(
  db: Database,
  core: CoreRepository,
  input: TurnInput,
  retrieved: readonly unknown[],
): TutorContext {
  const thread = db.one(
    `SELECT t.id,t.goal FROM threads t
     JOIN thread_conversations tc ON tc.thread_id=t.id
     WHERE tc.learner_id=? AND tc.conversation_id=? AND t.status='open'
     ORDER BY t.updated_at DESC LIMIT 1`,
    [input.owner, input.conversationId],
    z.object({ id: z.string(), goal: z.string() }),
  );
  const conversation = conversationGoal.parse(core.conversation(input.owner, input.conversationId));
  const recentContext = db
    .all(
      "SELECT * FROM messages WHERE learner_id=? AND conversation_id=? AND tombstoned_at IS NULL AND id<>? ORDER BY created_at DESC LIMIT 8",
      [input.owner, input.conversationId, input.messageId],
      messageRecord,
    )
    .toReversed();
  const documents = retrieved.flatMap((raw) => {
    const parsed = retrievalDocument.safeParse(raw);
    return parsed.success ? [parsed.data] : [];
  });
  const selected = new Set(
    documents
      .filter((document) => document.entity_type === "knowledge")
      .map((document) => document.id),
  );
  const evidenceDocumentIds = documents
    .filter((document) => document.entity_type === "evidence")
    .map((document) => document.id);
  const messageDocumentIds = documents
    .filter((document) => document.entity_type === "message")
    .map((document) => document.id);
  const addKnowledgeIds = (rows: readonly { readonly knowledge_id: string }[]): void => {
    for (const row of rows) selected.add(row.knowledge_id);
  };
  if (evidenceDocumentIds.length > 0)
    addKnowledgeIds(
      db.all(
        `SELECT DISTINCT knowledge_id FROM evidence WHERE learner_id=? AND id IN (${evidenceDocumentIds.map(() => "?").join(",")})`,
        [input.owner, ...evidenceDocumentIds],
        knowledgeIdRecord,
      ),
    );
  if (messageDocumentIds.length > 0)
    addKnowledgeIds(
      db.all(
        `SELECT DISTINCT knowledge_id FROM evidence WHERE learner_id=? AND message_id IN (${messageDocumentIds.map(() => "?").join(",")})`,
        [input.owner, ...messageDocumentIds],
        knowledgeIdRecord,
      ),
    );
  addKnowledgeIds(
    db.all(
      `SELECT DISTINCT e.knowledge_id FROM exposures e
       JOIN messages m ON m.id=e.message_id
       ${thread === null ? "" : "JOIN thread_conversations tc ON tc.conversation_id=m.conversation_id"}
       WHERE e.learner_id=? ${thread === null ? "AND m.conversation_id=?" : "AND tc.learner_id=? AND tc.thread_id=?"}
       ORDER BY e.created_at DESC LIMIT 12`,
      thread === null ? [input.owner, input.conversationId] : [input.owner, input.owner, thread.id],
      knowledgeIdRecord,
    ),
  );
  if (thread !== null) {
    const plans = db.all(
      "SELECT data_json FROM turn_plans WHERE learner_id=? AND thread_id=? ORDER BY created_at DESC LIMIT 4",
      [input.owner, thread.id],
      threadPlanRecord,
    );
    for (const plan of plans) {
      const parsedJson: unknown = JSON.parse(plan.data_json);
      const parsed = plannedUnitIds.safeParse(parsedJson);
      if (parsed.success)
        for (const id of [
          ...parsed.data.targetUnits,
          ...parsed.data.assumedUnits,
          ...parsed.data.introducedUnits,
          ...parsed.data.deferredUnits,
        ])
          selected.add(id);
    }
  }
  const seedIds = [...selected].slice(0, 16);
  const relationCandidates =
    seedIds.length === 0
      ? []
      : db.all(
          `SELECT id,from_knowledge_id,to_knowledge_id,kind,necessity,scaffoldable
           FROM knowledge_relations
           WHERE (learner_id IS NULL OR learner_id=?)
             AND (from_knowledge_id IN (${seedIds.map(() => "?").join(",")})
               OR to_knowledge_id IN (${seedIds.map(() => "?").join(",")}))
           ORDER BY CASE kind WHEN 'prerequisite' THEN 0 ELSE 1 END,created_at DESC,id DESC LIMIT 48`,
          [input.owner, ...seedIds, ...seedIds],
          relationRecord,
        );
  const selectedKnowledge = new Set(seedIds);
  const relations: z.infer<typeof relationRecord>[] = [];
  for (const relation of relationCandidates) {
    const missing = [relation.from_knowledge_id, relation.to_knowledge_id].filter(
      (id) => !selectedKnowledge.has(id),
    );
    if (selectedKnowledge.size + new Set(missing).size > 24) continue;
    selectedKnowledge.add(relation.from_knowledge_id);
    selectedKnowledge.add(relation.to_knowledge_id);
    relations.push(relation);
  }
  for (const id of selected) {
    if (selectedKnowledge.size >= 24) break;
    selectedKnowledge.add(id);
  }
  const selectedKnowledgeIds = [...selectedKnowledge];
  const placeholders = selectedKnowledgeIds.map(() => "?").join(",");
  const learnerStates =
    selectedKnowledgeIds.length === 0
      ? []
      : boundedRecords(
          db.all(
            `SELECT * FROM learner_state WHERE learner_id=? AND knowledge_id IN (${placeholders}) ORDER BY projected_at DESC`,
            [input.owner, ...selectedKnowledgeIds],
            stateRecord,
          ),
          6,
          12_000,
        );
  const supportingEvidence =
    selectedKnowledgeIds.length === 0
      ? []
      : boundedRecords(
          db.all(
            `SELECT * FROM evidence WHERE learner_id=? AND knowledge_id IN (${placeholders}) ORDER BY created_at DESC`,
            [input.owner, ...selectedKnowledgeIds],
            stateRecord,
          ),
          4,
          16_000,
        );
  return {
    currentGoal: thread?.goal ?? conversation.goal ?? input.content,
    threadId: thread?.id ?? null,
    selectedKnowledgeIds,
    recentContext,
    tutorTexts: recentContext
      .filter((message) => message.role === "tutor")
      .map((message) => message.content),
    relations,
    learnerStates,
    supportingEvidence,
    openQuestions:
      thread === null
        ? []
        : db.all(
            "SELECT * FROM open_questions WHERE learner_id=? AND thread_id=? AND status='open' ORDER BY created_at DESC LIMIT 12",
            [input.owner, thread.id],
            stateRecord,
          ),
  };
}
