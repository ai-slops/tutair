import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "../../src/client/api";
import { KnowledgePanel } from "../../src/client/components/KnowledgePanel";
import type { KnowledgeItem } from "../../src/client/model";

const http = vi.hoisted(() => {
  const requests: string[] = [];
  const conversation = {
    id: "conversation-linked",
    title: "Linked conversation",
    goal: "Continue learning",
    createdAt: "2026-09-19T20:00:00.000Z",
    updatedAt: "2026-09-19T20:00:00.000Z",
  };
  const client = {
    get: vi.fn((path: string) => ({
      json: () => {
        requests.push(`GET ${path}`);
        if (path === "threads/thread-search")
          return Promise.resolve({
            thread: thread("thread-search"),
            openQuestions: [],
            conversations: [conversation],
          });
        if (path === "threads/thread-empty")
          return Promise.resolve({
            thread: thread("thread-empty"),
            openQuestions: [],
            conversations: [],
          });
        if (path === "threads") return Promise.resolve({ threads: [thread("thread-search")] });
        if (path === "session") return Promise.resolve({ learner: { id: "learner" } });
        if (path === "capabilities")
          return Promise.resolve({
            provider: "disabled",
            model: null,
            generation: false,
            embedding: false,
            search: true,
            searchMode: "fts-only",
            synthetic: false,
          });
        if (path === "conversations") return Promise.resolve({ conversations: [conversation] });
        if (path === "knowledge") return Promise.resolve({ items: [] });
        if (path === "conversations/conversation-linked")
          return Promise.resolve({ conversation, messages: [], threads: [] });
        throw new TypeError(`Unexpected GET ${path}`);
      },
    })),
    post: vi.fn((path: string, _options?: unknown) => ({
      json: () => {
        requests.push(`POST ${path}`);
        if (path === "threads/thread-empty/resume" || path === "threads/thread-search/resume")
          return Promise.resolve({ conversation });
        throw new TypeError(`Unexpected POST ${path}`);
      },
    })),
    delete: vi.fn(),
  };
  function thread(id: string) {
    return {
      id,
      title: "FSM",
      conversationId: id === "thread-empty" ? null : conversation.id,
      goal: "Learn",
      origin: "question",
      whyNow: null,
      desiredOutcome: "Learn",
      status: "paused",
      targetKnowledgeUnitIds: [],
      deferredKnowledgeUnitIds: [],
      updatedAt: conversation.updatedAt,
    };
  }
  return { client, requests };
});

vi.mock("ky", () => ({
  default: { create: () => http.client },
  HTTPError: class HTTPError extends Error {},
}));

describe("thread resume and learner state", () => {
  beforeEach(() => {
    http.requests.length = 0;
    vi.clearAllMocks();
  });

  it("opens the most recent conversation linked to a thread search result", async () => {
    const result = await api.openSearchThread("thread-search");

    expect(result.activeConversationId).toBe("conversation-linked");
    expect(http.requests).toContain("GET threads/thread-search");
    expect(http.requests).not.toContain("GET conversations/thread-search");
    expect(http.requests).toContain("POST threads/thread-search/resume");
  });

  it("resumes a thread with no linked conversation", async () => {
    const result = await api.openSearchThread("thread-empty");

    expect(result.activeConversationId).toBe("conversation-linked");
    expect(http.requests).toContain("POST threads/thread-empty/resume");
  });

  it("allows a multi-stage tutor turn to exceed the ordinary request timeout", async () => {
    http.client.post.mockImplementationOnce(() => {
      throw new Error("Request observed");
    });
    await expect(api.sendMessage("conversation-linked", "Explain FSM")).rejects.toThrow();
    expect(http.client.post.mock.calls.at(-1)?.[1]).toMatchObject({ timeout: 300_000 });
  });

  it("renders six current-revision projection states without a mastery score", () => {
    const dimensions = [
      "Recognition",
      "Recall",
      "Explanation",
      "Application",
      "Discrimination",
      "Transfer",
    ] as const;
    const item = {
      id: "concept-1",
      name: "Bayes theorem",
      definition: "A rule for updating conditional probability.",
      revision: 2,
      sources: [],
      evidence: [],
      learnerState: dimensions.map((dimension, index) => ({
        dimension,
        estimate: 0.5 + index / 100,
        uncertainty: 0.4,
        status: "tentative" as const,
        effectiveEvidence: 1.25,
        projectionVersion: "projection-v1",
        knowledgeRevisionId: "revision-2",
        evidenceIds: [`evidence-${index}`],
      })),
    } satisfies KnowledgeItem;

    const markup = renderToStaticMarkup(
      <KnowledgePanel
        open
        items={[item]}
        selected={item}
        error={null}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onCorrect={vi.fn()}
      />,
    );

    expect(markup.match(/Effective evidence/g)).toHaveLength(6);
    expect(markup).toContain("Uncertainty</dt><dd>0.4");
    expect(markup.match(/class="learner-state-card"/g)).toHaveLength(6);
    expect(markup).not.toContain('role="progressbar"');
  });
});
