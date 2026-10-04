import { describe, expect, it } from "vitest";
import type { ThreadCreate, ThreadRecord } from "../../src/server/thread-schemas.js";
import {
  resolveLearningThread,
  ThreadSelectionAmbiguousError,
  type ThreadSelectionRepository,
} from "../../src/server/thread-selection.js";

const record = (id: string): ThreadRecord => ({
  id,
  learner_id: "learner",
  conversation_id: "conversation",
  title: id,
  goal: id,
  origin: "question",
  why_now: null,
  desired_outcome: id,
  target_knowledge_unit_ids_json: "[]",
  deferred_knowledge_unit_ids_json: "[]",
  status: "open",
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
});

class FakeThreadRepository implements ThreadSelectionRepository {
  readonly selected: string[] = [];
  readonly created: ThreadCreate[] = [];
  constructor(
    private readonly current: ThreadRecord | null,
    private readonly records: Readonly<Record<string, ThreadRecord>>,
  ) {}
  currentThread(): ThreadRecord | null {
    return this.current;
  }
  thread(_owner: string, id: string): ThreadRecord {
    const found = this.records[id];
    if (found === undefined) throw new RangeError("Unknown test thread");
    return found;
  }
  createThread(_owner: string, input: ThreadCreate): ThreadRecord {
    this.created.push(input);
    return record("new");
  }
  selectThread(_owner: string, _conversationId: string, id: string): ThreadRecord {
    this.selected.push(id);
    return this.thread(_owner, id);
  }
}

const newThread = { title: "New", goal: "New goal", conversationId: "conversation" } as const;

describe("resolveLearningThread", () => {
  it("keeps the stable current thread when candidate evidence is ambiguous", () => {
    // Given
    const current = record("current");
    const repository = new FakeThreadRepository(current, { current, other: record("other") });

    // When
    const result = resolveLearningThread(repository, {
      owner: "learner",
      conversationId: "conversation",
      candidates: [{ threadId: "other", decisive: false }],
      newThread,
    });

    // Then
    expect(result).toEqual({ thread: current, reason: "current" });
    expect(repository.selected).toEqual([]);
    expect(repository.created).toEqual([]);
  });

  it("keeps the stable current thread even when another candidate is decisive", () => {
    // Given
    const current = record("current");
    const repository = new FakeThreadRepository(current, { current, other: record("other") });

    // When
    const result = resolveLearningThread(repository, {
      owner: "learner",
      conversationId: "conversation",
      candidates: [{ threadId: "other", decisive: true }],
      newThread,
    });

    // Then
    expect(result).toEqual({ thread: current, reason: "current" });
    expect(repository.selected).toEqual([]);
  });

  it("switches only to a unique decisively relevant existing thread", () => {
    // Given
    const candidate = record("candidate");
    const repository = new FakeThreadRepository(null, { candidate });

    // When
    const result = resolveLearningThread(repository, {
      owner: "learner",
      conversationId: "conversation",
      candidates: [{ threadId: "candidate", decisive: true }],
      newThread,
    });

    // Then
    expect(result).toEqual({ thread: candidate, reason: "unique_decisive" });
    expect(repository.selected).toEqual(["candidate"]);
    expect(repository.created).toEqual([]);
  });

  it("creates a thread only for explicit new intent or no eligible candidate", () => {
    // Given
    const current = record("current");
    const explicitRepository = new FakeThreadRepository(current, { current });
    const emptyRepository = new FakeThreadRepository(null, {});

    // When
    const explicit = resolveLearningThread(explicitRepository, {
      owner: "learner",
      conversationId: "conversation",
      explicitNewIntent: true,
      newThread,
    });
    const empty = resolveLearningThread(emptyRepository, {
      owner: "learner",
      conversationId: "conversation",
      candidates: [],
      newThread,
    });

    // Then
    expect(explicit.reason).toBe("explicit_new");
    expect(empty.reason).toBe("no_candidate");
    expect(explicitRepository.created).toHaveLength(1);
    expect(emptyRepository.created).toHaveLength(1);
  });

  it("requires disambiguation instead of creating when candidates exist without a current thread", () => {
    // Given
    const repository = new FakeThreadRepository(null, {
      first: record("first"),
      second: record("second"),
    });

    // When
    const resolve = (): void => {
      resolveLearningThread(repository, {
        owner: "learner",
        conversationId: "conversation",
        candidates: [
          { threadId: "first", decisive: false },
          { threadId: "second", decisive: false },
        ],
        newThread,
      });
    };

    // Then
    expect(resolve).toThrow(ThreadSelectionAmbiguousError);
    const error = new ThreadSelectionAmbiguousError(["first", "second"]);
    expect(error).toMatchObject({
      status: 409,
      code: "thread_selection_ambiguous",
      details: { candidateIds: '["first","second"]' },
    });
    expect(repository.selected).toEqual([]);
    expect(repository.created).toEqual([]);
  });
});
