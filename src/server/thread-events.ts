import { z } from "zod";
import type { Database } from "./database.js";
import type { ThreadRecord } from "./thread-schemas.js";
import type { LearnerId } from "./types.js";
import { newId } from "./types.js";

export type ThreadEventSnapshot = {
  readonly title: string;
  readonly goal: string;
  readonly origin: ThreadRecord["origin"];
  readonly whyNow: string | null;
  readonly desiredOutcome: string;
  readonly targetKnowledgeUnitIds: readonly string[];
  readonly deferredKnowledgeUnitIds: readonly string[];
  readonly status: ThreadRecord["status"];
  readonly conversationId: string | null;
};

export const threadEventSnapshot = (thread: ThreadRecord): ThreadEventSnapshot => ({
  title: thread.title,
  goal: thread.goal,
  origin: thread.origin,
  whyNow: thread.why_now,
  desiredOutcome: thread.desired_outcome,
  targetKnowledgeUnitIds: z
    .array(z.string().uuid())
    .parse(JSON.parse(thread.target_knowledge_unit_ids_json)),
  deferredKnowledgeUnitIds: z
    .array(z.string().uuid())
    .parse(JSON.parse(thread.deferred_knowledge_unit_ids_json)),
  status: thread.status,
  conversationId: thread.conversation_id,
});

export const insertThreadEvent = (
  db: Database,
  input: {
    readonly owner: LearnerId;
    readonly threadId: string;
    readonly type: string;
    readonly data: Readonly<Record<string, unknown>>;
    readonly now: string;
  },
): void => {
  db.run("INSERT INTO thread_events VALUES(?,?,?,?,?,?)", [
    newId(),
    input.threadId,
    input.owner,
    input.type,
    JSON.stringify(input.data),
    input.now,
  ]);
};
