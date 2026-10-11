// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Conversation } from "../../src/client/components/Conversation";
import { KnowledgePanel } from "../../src/client/components/KnowledgePanel";
import { KnowledgeQueues } from "../../src/client/components/KnowledgeQueues";
import { ThreadDialog } from "../../src/client/components/ThreadDialog";
import { ThreadPanel } from "../../src/client/components/ThreadPanel";
import { WorkspaceHeader } from "../../src/client/components/WorkspaceHeader";

afterEach(cleanup);
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
});

describe("learning lifecycle controls", () => {
  it("labels the main title as a conversation", () => {
    render(
      <WorkspaceHeader
        title="Reducer composition"
        provider={{ mode: "configured", label: "Tutor ready", guidance: "Ready" }}
        canEditGoal={true}
        onThreads={vi.fn()}
        onEditGoal={vi.fn()}
        onKnowledge={vi.fn()}
        onSettings={vi.fn()}
      />,
    );

    expect(screen.getByText("Conversation")).toBeTruthy();
    expect(screen.queryByText("Learning thread")).toBeNull();
  });

  it("labels the compact evidence drawer control as Overview", () => {
    HTMLElement.prototype.scrollIntoView = vi.fn();
    render(
      <Conversation
        messages={[]}
        provider={{ mode: "configured", label: "Tutor ready", guidance: "Ready" }}
        draft=""
        submitting={false}
        showProgress={false}
        error={null}
        onDraft={vi.fn()}
        onSubmit={vi.fn()}
        onRetry={vi.fn()}
        onKnowledge={vi.fn()}
        recovery={null}
      />,
    );

    const control = screen.getByRole("button", { name: "Overview" });
    expect(control.classList.contains("mobile-only")).toBe(true);
  });

  it("uses instant conversation scrolling when reduced motion is requested", () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(prefers-reduced-motion: reduce)",
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    const scrollIntoView = vi.fn();
    HTMLElement.prototype.scrollIntoView = scrollIntoView;

    render(
      <Conversation
        messages={[]}
        provider={{ mode: "configured", label: "Tutor ready", guidance: "Ready" }}
        draft=""
        submitting={false}
        showProgress={false}
        error={null}
        onDraft={vi.fn()}
        onSubmit={vi.fn()}
        onRetry={vi.fn()}
        onKnowledge={vi.fn()}
        recovery={null}
      />,
    );

    expect(scrollIntoView).toHaveBeenCalledWith({ behavior: "auto", block: "end" });
  });

  it("creates a learning thread from an outcome when the optional title is empty", async () => {
    const save = vi.fn(() => Promise.resolve(true));
    const user = userEvent.setup();
    render(
      <ThreadDialog
        mode="create"
        initial={{ title: "", desiredOutcome: "", origin: "question", whyNow: "" }}
        error={null}
        onClose={vi.fn()}
        onSave={save}
      />,
    );

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await user.type(screen.getByLabelText("Desired outcome"), "Explain reducer composition");
    await user.click(screen.getByRole("button", { name: "Start learning thread" }));

    expect(save).toHaveBeenCalledWith({
      title: "Explain reducer composition",
      desiredOutcome: "Explain reducer composition",
      origin: "question",
      whyNow: "",
    });
  });

  it("offers resolve and park actions for an open question", async () => {
    const setStatus = vi.fn(() => Promise.resolve(true));
    const user = userEvent.setup();
    render(
      <KnowledgeQueues
        deferred={[]}
        questions={[
          { id: "question-1", question: "When should this reducer run?", status: "open" },
        ]}
        error={null}
        onPromote={() => Promise.resolve(true)}
        onAddQuestion={() => Promise.resolve(true)}
        onSetQuestionStatus={setStatus}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Resolve question" }));
    expect(setStatus).toHaveBeenCalledWith("question-1", "resolved");
  });

  it("reopens a parked question", async () => {
    const setStatus = vi.fn(() => Promise.resolve(true));
    const user = userEvent.setup();
    render(
      <KnowledgeQueues
        deferred={[]}
        questions={[
          { id: "question-1", question: "When should this reducer run?", status: "parked" },
        ]}
        error={null}
        onPromote={() => Promise.resolve(true)}
        onAddQuestion={() => Promise.resolve(true)}
        onSetQuestionStatus={setStatus}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reopen question" }));
    expect(setStatus).toHaveBeenCalledWith("question-1", "open");
  });

  it("moves deferred knowledge to learning targets without changing knowledge state", async () => {
    const include = vi.fn(() => Promise.resolve(true));
    const user = userEvent.setup();
    render(
      <KnowledgeQueues
        deferred={[
          {
            id: "knowledge-1",
            name: "Reducer composition",
            definition: "Reducers can be composed.",
            revision: 1,
            sources: [],
            evidence: [],
            learnerState: [],
          },
        ]}
        questions={[]}
        error={null}
        onPromote={include}
        onAddQuestion={() => Promise.resolve(true)}
        onSetQuestionStatus={() => Promise.resolve(true)}
      />,
    );

    expect(screen.getByText("Deferred here; this does not change knowledge state.")).toBeTruthy();
    expect(screen.queryByText(/promote|master/i)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Move to learning targets" }));
    expect(include).toHaveBeenCalledWith("knowledge-1");
  });

  it("names the evidence panel Overview without mastery wording", () => {
    render(
      <KnowledgePanel
        open={false}
        items={[]}
        selected={null}
        learningThread={{
          id: "thread-1",
          conversationId: null,
          title: "Reducer study",
          goal: "Understand reducers",
          origin: "project",
          whyNow: null,
          desiredOutcome: "Explain reducer composition",
          status: "open",
          targetKnowledgeUnitIds: [],
          deferredKnowledgeUnitIds: [],
          updatedAt: "2026-10-04",
          questions: [],
        }}
        onClose={vi.fn()}
        error="The learning question could not be updated."
        onSelect={vi.fn()}
        onCorrect={vi.fn()}
        onPromote={() => Promise.resolve(true)}
        onAddQuestion={() => Promise.resolve(true)}
        onSetQuestionStatus={() => Promise.resolve(true)}
      />,
    );

    expect(screen.getByRole("heading", { name: "Overview" })).toBeTruthy();
    expect(screen.getByText("Deferred here; this does not change knowledge state.")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toBe(
      "The learning question could not be updated.",
    );
    expect(screen.queryByRole("button", { name: /master/i })).toBeNull();
  });

  it("pauses an open learning thread from its status-aware row", async () => {
    const setStatus = vi.fn(() => Promise.resolve(true));
    const user = userEvent.setup();
    render(
      <ThreadPanel
        conversations={[]}
        learningThreads={[learningThread("open"), learningThread("paused")]}
        activeConversationId={null}
        activeLearningThreadId="thread-open"
        threadStatusBusy={false}
        onNewConversation={vi.fn()}
        onStartLearningThread={vi.fn()}
        onSelectConversation={vi.fn()}
        onResumeLearningThread={vi.fn()}
        onSetLearningThreadStatus={setStatus}
      />,
    );

    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Resume Understand reducers" })).toBeNull();
    expect(screen.getByRole("button", { name: "Resume Review reducers" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Pause Understand reducers" }));
    expect(setStatus).toHaveBeenCalledWith("thread-open", "paused");
  });
});

function learningThread(status: "open" | "paused" | "resolved" | "abandoned") {
  const desiredOutcome = status === "paused" ? "Review reducers" : "Understand reducers";
  return {
    id: `thread-${status}`,
    conversationId: null,
    title: "Reducer study",
    goal: desiredOutcome,
    origin: "project" as const,
    whyNow: null,
    desiredOutcome,
    status,
    targetKnowledgeUnitIds: [],
    deferredKnowledgeUnitIds: [],
    updatedAt: "2026-10-04",
  };
}
