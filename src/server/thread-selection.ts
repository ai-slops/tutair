import type { ThreadCreate, ThreadRecord } from "./thread-schemas.js";
import type { LearnerId } from "./types.js";
import { ApiError } from "./types.js";

export type ThreadCandidate = {
  readonly threadId: string;
  readonly decisive: boolean;
};

export type ThreadSelectionInput = {
  readonly owner: LearnerId;
  readonly conversationId: string;
  readonly explicitThreadId?: string;
  readonly explicitNewIntent?: boolean;
  readonly candidates?: readonly ThreadCandidate[];
  readonly newThread: ThreadCreate;
};

export type ThreadSelection = {
  readonly thread: ThreadRecord;
  readonly reason: "explicit" | "explicit_new" | "current" | "unique_decisive" | "no_candidate";
};

export interface ThreadSelectionRepository {
  currentThread(owner: LearnerId, conversationId: string): ThreadRecord | null;
  thread(owner: LearnerId, id: string): ThreadRecord;
  createThread(owner: LearnerId, input: ThreadCreate): ThreadRecord;
  selectThread(owner: LearnerId, conversationId: string, id: string, reason: string): ThreadRecord;
}

export class ThreadSelectionAmbiguousError extends ApiError {
  constructor(readonly candidateThreadIds: readonly string[]) {
    super(409, "thread_selection_ambiguous", "Thread selection requires explicit disambiguation", {
      candidateIds: JSON.stringify(candidateThreadIds),
    });
  }
}

export const resolveLearningThread = (
  repository: ThreadSelectionRepository,
  input: ThreadSelectionInput,
): ThreadSelection => {
  if (input.explicitThreadId !== undefined)
    return {
      thread: repository.selectThread(
        input.owner,
        input.conversationId,
        input.explicitThreadId,
        "explicit",
      ),
      reason: "explicit",
    };
  if (input.explicitNewIntent === true)
    return {
      thread: repository.createThread(input.owner, {
        ...input.newThread,
        conversationId: input.conversationId,
      }),
      reason: "explicit_new",
    };
  const current = repository.currentThread(input.owner, input.conversationId);
  if (current !== null) return { thread: current, reason: "current" };
  const decisiveIds = [
    ...new Set(
      (input.candidates ?? [])
        .filter((candidate) => candidate.decisive)
        .map((candidate) => candidate.threadId),
    ),
  ];
  const decisiveId = decisiveIds.length === 1 ? decisiveIds[0] : undefined;
  if (decisiveId !== undefined)
    return {
      thread: repository.selectThread(
        input.owner,
        input.conversationId,
        decisiveId,
        "unique_decisive",
      ),
      reason: "unique_decisive",
    };
  const candidateIds = [
    ...new Set((input.candidates ?? []).map((candidate) => candidate.threadId)),
  ];
  if (candidateIds.length > 0) throw new ThreadSelectionAmbiguousError(candidateIds);
  return {
    thread: repository.createThread(input.owner, {
      ...input.newThread,
      conversationId: input.conversationId,
    }),
    reason: "no_candidate",
  };
};
