// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  review: vi.fn(() => Promise.resolve(true)),
  workspace: {
    snapshot: {
      conversations: [],
      activeConversationId: null,
      learningThreads: [],
      activeLearningThread: null,
      recovery: null,
      messages: [],
      knowledge: [
        {
          id: "knowledge-1",
          name: "상태 기계",
          definition: "유한한 상태와 전이 규칙을 가진 모델입니다.",
          revision: 2,
          scope: "canonical",
          kind: "concept",
          semanticScope: "formal systems",
          sources: ["reference-v2"],
          evidence: [],
          learnerState: [],
          reviewStatus: {
            status: "unreviewed",
            revision: 2,
            revisionId: "revision-2",
            reason: null,
            updatedAt: null,
          },
          revisions: [
            {
              id: "revision-1",
              revision: 1,
              statement: "첫 정의",
              sourceType: "canonical_import",
              sourceRef: "reference-v1",
              createdAt: "2026-10-01T00:00:00.000Z",
            },
            {
              id: "revision-2",
              revision: 2,
              statement: "유한한 상태와 전이 규칙을 가진 모델입니다.",
              sourceType: "canonical_import",
              sourceRef: "reference-v2",
              createdAt: "2026-10-02T00:00:00.000Z",
            },
          ],
          reviewHistory: [],
          documents: [
            {
              id: "document-en-1",
              role: "english_base",
              languageTag: "en",
              version: 2,
              sourceType: "canonical_import",
              sourceRefs: ["reference-v2"],
              createdAt: "2026-10-02T00:00:00.000Z",
              stale: false,
              blocks: [
                {
                  id: "block-en-1",
                  type: "definition",
                  content: "A model with finite states and transition rules.",
                  contentHash: "1234567890abcdef",
                  sourceBlockId: null,
                },
              ],
            },
            {
              id: "document-ko-1",
              role: "localization",
              languageTag: "ko",
              version: 1,
              sourceType: "model_generated",
              sourceRefs: [],
              createdAt: "2026-10-02T00:01:00.000Z",
              stale: true,
              blocks: [
                {
                  id: "block-ko-1",
                  type: "definition",
                  content: "유한한 상태와 전이 규칙을 가진 모델입니다.",
                  contentHash: "abcdef1234567890",
                  sourceBlockId: "block-en-1",
                },
              ],
            },
          ],
        },
        {
          id: "knowledge-2",
          name: "Graph traversal",
          definition: "Visits graph vertices.",
          revision: 1,
          scope: "provisional",
          kind: "procedure",
          semanticScope: "algorithms",
          sources: [],
          evidence: [],
          learnerState: [],
          reviewStatus: {
            status: "retired",
            revision: 1,
            revisionId: "revision-3",
            reason: "No longer relevant",
            updatedAt: "2026-10-03T00:00:00.000Z",
          },
          revisions: [],
          reviewHistory: [],
        },
      ],
      misconceptions: [
        {
          id: "misconception-1",
          revision: 1,
          revisionId: "misconception-revision-1",
          label: "States are events",
          mistakenProposition: "A state is the event that causes a transition.",
          correction: "A state persists; an event can trigger a transition.",
          failureTask: "Trace a turnstile after a coin event.",
          likelyError: "Labels coin as a state.",
          discriminatingExample: {
            scenario: "A locked turnstile receives a coin.",
            mistakenResponse: "Coin is the new state.",
            correctedResponse: "Unlocked is the new state.",
            decisiveCue: "Unlocked persists after the trigger.",
          },
          reuseValueReason: "This confusion recurs across event-driven systems.",
          definitionRevisionLinks: [
            {
              definitionRevisionId: "revision-2",
              role: "subject",
              learningValue: "Separates persistent configuration from the triggering event.",
            },
          ],
          reviewStatus: "unreviewed",
          reviewHistory: [],
          eligibilityReason: null,
          createdAt: "2026-10-02T00:00:00.000Z",
        },
      ],
      provider: { mode: "configured", label: "Tutor ready", guidance: "Ready" },
      chatgpt: {
        enabled: false,
        connected: false,
        manualCallback: false,
        selectedModel: null,
        models: [],
      },
    },
    initialized: true,
    loading: false,
    turnPending: false,
    error: "The review could not be saved.",
    refresh: vi.fn(),
    createConversation: vi.fn(),
    createLearningThread: vi.fn(),
    openConversation: vi.fn(),
    openSearchThread: vi.fn(),
    send: vi.fn(),
    resolveTurn: vi.fn(),
    retryTurn: vi.fn(),
    updateLearningThread: vi.fn(),
    setThreadStatus: vi.fn(),
    addQuestion: vi.fn(),
    setQuestionStatus: vi.fn(),
    promoteKnowledge: vi.fn(),
    createSession: vi.fn(),
    correct: vi.fn(),
    review: vi.fn(() => Promise.resolve(true)),
    reviewMisconception: vi.fn(() => Promise.resolve(true)),
    deleteAll: vi.fn(),
    selectChatGptModel: vi.fn(),
    beginChatGptManual: vi.fn(),
    completeChatGptManual: vi.fn(),
    disconnectChatGpt: vi.fn(),
    search: { results: [], mode: null, loading: false, error: null, run: vi.fn() },
  },
}));

vi.mock("../../src/client/useWorkspace", () => ({ useWorkspace: () => state.workspace }));

import { App } from "../../src/client/App";

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
  state.workspace.review.mockReset();
  state.workspace.review.mockResolvedValue(true);
  state.workspace.correct.mockReset();
  state.workspace.correct.mockResolvedValue(true);
  state.workspace.reviewMisconception.mockReset();
  state.workspace.reviewMisconception.mockResolvedValue(true);
});
afterEach(cleanup);

describe("knowledge manager", () => {
  it("opens from the workspace header and browses searchable status-filtered definitions", async () => {
    // Given
    const user = userEvent.setup();
    render(<App />);

    // When
    await user.click(screen.getByRole("button", { name: "Manage knowledge" }));

    // Then
    expect(screen.getByRole("heading", { name: "Knowledge manager" })).toBeTruthy();
    expect(screen.getAllByText("유한한 상태와 전이 규칙을 가진 모델입니다.")).toHaveLength(2);
    expect(screen.getByText("reference-v2")).toBeTruthy();
    expect(screen.getByText("Revision 1")).toBeTruthy();
    await user.type(screen.getByRole("searchbox", { name: "Search knowledge" }), "graph");
    expect(screen.queryByRole("button", { name: /상태 기계/ })).toBeNull();
    expect(screen.getByRole("button", { name: /Graph traversal/ })).toBeTruthy();
    await user.selectOptions(screen.getByLabelText("Review status"), "unreviewed");
    expect(screen.getByText("No knowledge matches these filters.")).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("outside the current filters");
  });

  it("reviews separate misconception records without presenting them as learner diagnoses", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Manage knowledge" }));
    await user.click(screen.getByRole("button", { name: "Misconceptions" }));

    expect(screen.getAllByText("Potential general learning risk").length).toBeGreaterThan(0);
    expect(screen.getByText("A state is the event that causes a transition.")).toBeTruthy();
    expect(screen.getByText("A state persists; an event can trigger a transition.")).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Mark reviewed" }));
    expect(state.workspace.reviewMisconception).toHaveBeenCalledWith(
      "misconception-1",
      "reviewed",
      "",
      false,
    );
  });

  it("reports an inline review failure without losing the selected definition", async () => {
    // Given
    state.workspace.review.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Manage knowledge" }));
    const action = screen.getByRole<HTMLButtonElement>("button", { name: "Mark reviewed" });

    // When
    await user.click(action);

    // Then
    expect(screen.getByRole("alert").textContent).toContain("could not be saved");
    expect(action.disabled).toBe(false);
    expect(screen.getByRole("heading", { name: "상태 기계" })).toBeTruthy();
  });

  it("inspects immutable English and localized document versions", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Manage knowledge" }));

    expect(screen.getByRole("heading", { name: "Learner-facing documents" })).toBeTruthy();
    expect(screen.getByText("2 immutable")).toBeTruthy();
    expect(screen.getByText("English source")).toBeTruthy();
    expect(screen.getByText("Localization")).toBeTruthy();
    expect(screen.getByText(/localization is stale/i)).toBeTruthy();
    expect(screen.getByText("A model with finite states and transition rules.")).toBeTruthy();
    expect(screen.getByText("hash 1234567890ab")).toBeTruthy();
  });

  it("explains unreviewed eligibility and opens revise correction for the selected unit", async () => {
    // Given
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Manage knowledge" }));
    expect(screen.getByText(/Unreviewed definitions remain available/i)).toBeTruthy();

    // When
    await user.click(screen.getByRole("button", { name: "Suggest correction" }));

    // Then
    expect(screen.getByRole("dialog", { name: "Suggest a correction" })).toBeTruthy();
    expect(screen.getByLabelText<HTMLSelectElement>("Correction intent").value).toBe("revise");
    await user.type(screen.getByLabelText("Correction"), "더 정확한 새 정의입니다.");
    await user.click(screen.getByRole("button", { name: "Submit correction" }));
    expect(state.workspace.correct).toHaveBeenCalledWith(
      expect.objectContaining({ id: "knowledge-1", revision: 2 }),
      "더 정확한 새 정의입니다.",
      "revise",
    );
  });

  it("requires a reason for marking a definition incorrect and preserves the draft on failure", async () => {
    // Given
    state.workspace.review.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Manage knowledge" }));

    // When
    await user.click(screen.getByRole("button", { name: "Mark incorrect" }));
    const reason = screen.getByLabelText<HTMLTextAreaElement>("Reason");
    await user.click(screen.getByRole("button", { name: "Confirm incorrect" }));
    expect(screen.getByRole("alert").textContent).toContain("Enter a reason");
    expect(state.workspace.review).not.toHaveBeenCalled();
    await user.type(reason, "정의가 중력 조건을 빠뜨렸습니다.");
    expect(reason.value).toBe("정의가 중력 조건을 빠뜨렸습니다.");
    const submit = screen.getByRole<HTMLButtonElement>("button", { name: "Confirm incorrect" });
    expect(submit.disabled).toBe(false);
    await user.click(submit);

    // Then
    expect(state.workspace.review).toHaveBeenCalledWith(
      "knowledge-1",
      "mark_incorrect",
      "정의가 중력 조건을 빠뜨렸습니다.",
      false,
    );
    expect(reason.value).toBe("정의가 중력 조건을 빠뜨렸습니다.");
    expect(screen.getByRole("alert").textContent).toContain("could not be saved");
  });

  it("requires explicit confirmation before restoring a retired unit", async () => {
    // Given
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Manage knowledge" }));
    await user.click(screen.getByRole("button", { name: /Graph traversal/ }));

    // When
    await user.click(screen.getByRole("button", { name: "Restore unit" }));

    // Then
    const confirm = screen.getByRole("checkbox", { name: /make this unit eligible/i });
    expect(
      screen.getByRole<HTMLButtonElement>("button", { name: "Confirm restore" }).disabled,
    ).toBe(true);
    await user.click(confirm);
    await user.click(screen.getByRole("button", { name: "Confirm restore" }));
    expect(state.workspace.review).toHaveBeenCalledWith("knowledge-2", "restore", "", true);
  });

  it("retains restore confirmation when the request fails", async () => {
    // Given
    state.workspace.review.mockResolvedValue(false);
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "Manage knowledge" }));
    await user.click(screen.getByRole("button", { name: /Graph traversal/ }));
    await user.click(screen.getByRole("button", { name: "Restore unit" }));
    const confirm = screen.getByRole<HTMLInputElement>("checkbox", {
      name: /make this unit eligible/i,
    });
    await user.click(confirm);

    // When
    await user.click(screen.getByRole("button", { name: "Confirm restore" }));

    // Then
    expect(confirm.checked).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("could not be saved");
  });
});
