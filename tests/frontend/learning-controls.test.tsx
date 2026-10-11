// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { clearMatchingRecoveredDraft } from "../../src/client/app-state";
import { KnowledgeQueues } from "../../src/client/components/KnowledgeQueues";
import { RecoveryNotice } from "../../src/client/components/RecoveryNotice";
import { ThreadDialog } from "../../src/client/components/ThreadDialog";
import { ThreadPanel } from "../../src/client/components/ThreadPanel";
import { TrackingNotice } from "../../src/client/components/TrackingNotice";

afterEach(cleanup);

describe("learning controls", () => {
  it("reports skipped evaluation and exposure tracking on the affected response", () => {
    render(
      <TrackingNotice
        status={{
          evaluationSkipped: true,
          extractionFallback: false,
          lintSkipped: false,
          exposureTrackingSkipped: true,
          followupTrackingSkipped: false,
        }}
      />,
    );

    expect(screen.getByText("Evaluation skipped")).toBeTruthy();
    expect(screen.getByText("Exposure tracking skipped")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("resolves an ambiguous selection once without resending the learner message", async () => {
    const select = vi.fn(() => Promise.resolve(true));
    const user = userEvent.setup();
    render(
      <RecoveryNotice
        kind="selection"
        content="FSM"
        message="Choose a thread."
        candidates={[
          learningThread("thread-1", "Understand state machines"),
          learningThread("thread-2", "Ship the parser"),
        ]}
        busy={false}
        error={null}
        onSelect={select}
        onStartNew={() => Promise.resolve(true)}
        onRetry={() => Promise.resolve(true)}
        onRefresh={vi.fn()}
        onRecovered={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Understand state machines/i }));

    expect(select).toHaveBeenCalledOnce();
    expect(select).toHaveBeenCalledWith("thread-1");
  });

  it("continues a running saved request through the stable retry action", async () => {
    const retry = vi.fn(() => Promise.resolve(true));
    const user = userEvent.setup();
    render(
      <RecoveryNotice
        kind="running"
        content="FSM"
        message="The saved request is still running."
        candidates={[]}
        busy={false}
        error={null}
        onSelect={() => Promise.resolve(true)}
        onStartNew={() => Promise.resolve(true)}
        onRetry={retry}
        onRefresh={vi.fn()}
        onRecovered={vi.fn()}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Continue saved request" }));

    expect(retry).toHaveBeenCalledOnce();
  });

  it("checks delivery when request persistence is unknown", async () => {
    const retry = vi.fn(() => Promise.resolve(true));
    const user = userEvent.setup();
    render(
      <RecoveryNotice
        kind="unknown"
        content="FSM"
        message="Delivery could not be confirmed."
        candidates={[]}
        busy={false}
        error={null}
        onSelect={() => Promise.resolve(true)}
        onStartNew={() => Promise.resolve(true)}
        onRetry={retry}
        onRefresh={vi.fn()}
        onRecovered={vi.fn()}
      />,
    );

    expect(screen.getByText("Request delivery unconfirmed")).toBeTruthy();
    expect(screen.queryByText("Saved request in progress")).toBeNull();
    await user.click(screen.getByRole("button", { name: "Check request delivery" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("does not clear a draft when checking delivery fails", async () => {
    const recovered = vi.fn();
    const user = userEvent.setup();
    render(
      <RecoveryNotice
        kind="unknown"
        content="FSM"
        message="Delivery could not be confirmed."
        candidates={[]}
        busy={false}
        error={null}
        onSelect={() => Promise.resolve(true)}
        onStartNew={() => Promise.resolve(true)}
        onRetry={() => Promise.resolve(false)}
        onRefresh={vi.fn()}
        onRecovered={recovered}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Check request delivery" }));
    expect(recovered).not.toHaveBeenCalled();
  });

  it("clears a composer draft that matches recovered saved content", () => {
    let current = "FSM";
    clearMatchingRecoveredDraft("FSM", (update) => {
      current = update(current);
    });
    expect(current).toBe("");
  });

  it("preserves a newer composer draft after recovering saved content", () => {
    let current = "A newer question";
    clearMatchingRecoveredDraft("FSM", (update) => {
      current = update(current);
    });
    expect(current).toBe("A newer question");
  });

  it("refreshes a failed saved request without offering a blind retry", async () => {
    const refresh = vi.fn();
    const user = userEvent.setup();
    render(
      <RecoveryNotice
        kind="failed"
        content="FSM"
        message="The saved request needs review."
        candidates={[]}
        busy={false}
        error={null}
        onSelect={() => Promise.resolve(true)}
        onStartNew={() => Promise.resolve(true)}
        onRetry={() => Promise.resolve(true)}
        onRefresh={refresh}
        onRecovered={vi.fn()}
      />,
    );

    expect(screen.queryByRole("button", { name: "Continue saved request" })).toBeNull();
    await user.click(screen.getByRole("button", { name: "Refresh conversation" }));
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("keeps goal metadata and the dialog open when saving fails", async () => {
    const close = vi.fn();
    const save = vi.fn(() => Promise.resolve(false));
    const user = userEvent.setup();
    render(
      <ThreadDialog
        mode="edit"
        initial={{
          title: "Reducer study",
          desiredOutcome: "Learn reducers",
          origin: "project",
          whyNow: "Release Friday",
        }}
        error="The learning thread could not be saved."
        onClose={close}
        onSave={save}
      />,
    );

    await settleInitialFocus();
    await user.clear(screen.getByLabelText("Desired outcome"));
    await user.type(screen.getByLabelText("Desired outcome"), "Learn reducer composition");
    await user.click(screen.getByRole("button", { name: "Save changes" }));

    expect(save).toHaveBeenCalledWith({
      title: "Reducer study",
      desiredOutcome: "Learn reducer composition",
      origin: "project",
      whyNow: "Release Friday",
    });
    expect(close).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue("Learn reducer composition")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });

  it("closes a start dialog only after a successful save", async () => {
    const close = vi.fn();
    const save = vi.fn(() => Promise.resolve(true));
    const user = userEvent.setup();
    render(
      <ThreadDialog
        mode="create"
        initial={{ title: "", desiredOutcome: "", origin: "question", whyNow: "" }}
        error={null}
        onClose={close}
        onSave={save}
      />,
    );

    await settleInitialFocus();
    await user.type(screen.getByLabelText("Title (optional)"), "Graph traversal");
    await user.type(screen.getByLabelText("Desired outcome"), "Understand graph traversal");
    await user.click(screen.getByRole("button", { name: "Start learning thread" }));

    expect(close).toHaveBeenCalledOnce();
  });

  it("traps Tab and closes once on Escape with the latest dialog callback", async () => {
    const firstClose = vi.fn();
    const latestClose = vi.fn();
    const user = userEvent.setup();
    const view = render(
      <ThreadDialog
        mode="edit"
        initial={{
          title: "Graph traversal",
          desiredOutcome: "Explain breadth-first search",
          origin: "question",
          whyNow: "Review tomorrow",
        }}
        error={null}
        onClose={firstClose}
        onSave={() => Promise.resolve(true)}
      />,
    );
    view.rerender(
      <ThreadDialog
        mode="edit"
        initial={{
          title: "Graph traversal",
          desiredOutcome: "Explain breadth-first search",
          origin: "question",
          whyNow: "Review tomorrow",
        }}
        error={null}
        onClose={latestClose}
        onSave={() => Promise.resolve(true)}
      />,
    );
    await settleInitialFocus();

    const save = screen.getByRole("button", { name: "Save changes" });
    save.focus();
    await user.keyboard("{Tab}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Close dialog" }));
    await user.keyboard("{Escape}");

    expect(firstClose).not.toHaveBeenCalled();
    expect(latestClose).toHaveBeenCalledOnce();
  });

  it("separates conversations from durable learning threads", () => {
    render(
      <ThreadPanel
        conversations={[
          { id: "conversation-1", title: "Today’s question", updatedAt: "2026-10-04" },
        ]}
        learningThreads={[learningThread("thread-1", "Understand state machines")]}
        activeConversationId="conversation-1"
        activeLearningThreadId="thread-1"
        threadStatusBusy={false}
        onNewConversation={vi.fn()}
        onStartLearningThread={vi.fn()}
        onSelectConversation={vi.fn()}
        onResumeLearningThread={vi.fn()}
        onSetLearningThreadStatus={() => Promise.resolve(true)}
      />,
    );

    expect(screen.getByRole("heading", { name: "Conversations" })).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Learning threads" })).toBeTruthy();
    expect(screen.getByText("Current")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /Resume Understand state machines/i })).toBeNull();
  });

  it("promotes deferred knowledge and resolves an open question explicitly", async () => {
    const promote = vi.fn(() => Promise.resolve(true));
    const setStatus = vi.fn(() => Promise.resolve(true));
    const addQuestion = vi.fn(() => Promise.resolve(true));
    const user = userEvent.setup();
    render(
      <KnowledgeQueues
        deferred={[
          {
            id: "unit-1",
            name: "Reducer composition",
            definition: "Reducers compose state transitions.",
            revision: 1,
            scope: "provisional",
            kind: "concept",
            semanticScope: "",
            sources: [],
            evidence: [],
            learnerState: [],
            reviewStatus: {
              status: "unreviewed",
              revision: 1,
              revisionId: "revision-1",
              reason: null,
              updatedAt: null,
            },
            revisions: [],
            reviewHistory: [],
          },
        ]}
        questions={[
          { id: "question-1", question: "When should this reducer run?", status: "open" },
        ]}
        error={null}
        onPromote={promote}
        onAddQuestion={addQuestion}
        onSetQuestionStatus={setStatus}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Move to learning targets" }));
    await user.click(screen.getByRole("button", { name: "Resolve question" }));

    expect(promote).toHaveBeenCalledWith("unit-1");
    expect(setStatus).toHaveBeenCalledWith("question-1", "resolved");
  });

  it("preserves an open-question draft when adding it fails", async () => {
    const addQuestion = vi.fn(() => Promise.resolve(false));
    const user = userEvent.setup();
    render(
      <KnowledgeQueues
        deferred={[]}
        questions={[]}
        error="The question could not be added."
        onPromote={() => Promise.resolve(true)}
        onAddQuestion={addQuestion}
        onSetQuestionStatus={() => Promise.resolve(true)}
      />,
    );

    await user.type(screen.getByLabelText("New open question"), "How does this compose?");
    await user.click(screen.getByRole("button", { name: "Add question" }));

    expect(screen.getByDisplayValue("How does this compose?")).toBeTruthy();
    expect(screen.getByRole("alert")).toBeTruthy();
  });
});

function learningThread(id: string, desiredOutcome: string) {
  return {
    id,
    conversationId: null,
    title: desiredOutcome,
    goal: desiredOutcome,
    origin: "project" as const,
    whyNow: "Parser review",
    desiredOutcome,
    status: "open" as const,
    targetKnowledgeUnitIds: [],
    deferredKnowledgeUnitIds: [],
    updatedAt: "2026-10-04",
  };
}

async function settleInitialFocus(): Promise<void> {
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
}
