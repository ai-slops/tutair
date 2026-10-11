// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Conversation } from "../../src/client/components/Conversation";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

describe("tutor progress", () => {
  it("shows only recorded stages and opens generation details", () => {
    const inspect = vi.fn();
    render(
      <Conversation
        messages={[]}
        provider={{ mode: "configured", label: "Tutor ready", guidance: "Ready" }}
        draft=""
        submitting={true}
        showProgress={true}
        error={null}
        onDraft={vi.fn()}
        onSubmit={vi.fn()}
        onRetry={vi.fn()}
        onKnowledge={vi.fn()}
        onInspectGeneration={inspect}
        pipeline={{
          requestId: "request-1",
          userMessageId: "message-1",
          tutorMessageId: null,
          state: "running",
          startedAt: "2026-10-11T00:00:00.000Z",
          finishedAt: null,
          error: null,
          flags: null,
          stages: [
            {
              runId: "run-1",
              stage: "evaluation",
              status: "completed",
              attempt: 1,
              repairOfRunId: null,
              startedAt: "2026-10-11T00:00:00.000Z",
              finishedAt: "2026-10-11T00:00:01.000Z",
              durationMs: 1000,
              provider: "demo",
              model: null,
              outputMode: null,
              usage: null,
              errorCode: null,
              fallbackStatus: "none",
              versions: { stage: "v1", prompt: "p1", schema: "s1", context: "c1" },
              contextHash: "hash",
            },
            {
              runId: "run-2",
              stage: "extraction",
              status: "running",
              attempt: 1,
              repairOfRunId: null,
              startedAt: "2026-10-11T00:00:01.000Z",
              finishedAt: null,
              durationMs: null,
              provider: "demo",
              model: null,
              outputMode: null,
              usage: null,
              errorCode: null,
              fallbackStatus: null,
              versions: { stage: "v1", prompt: "p1", schema: "s1", context: "c1" },
              contextHash: "hash",
            },
          ],
        }}
        recovery={null}
      />,
    );

    expect(screen.getByText("Evaluated your latest message")).toBeDefined();
    expect(screen.getByText("Extracting relevant concepts")).toBeDefined();
    expect(screen.queryByText("Planning the explanation")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "View generation details" }));
    expect(inspect).toHaveBeenCalledWith("request-1");
  });

  it("offers persisted generation details from a completed tutor answer", () => {
    const inspect = vi.fn();
    render(
      <Conversation
        messages={[
          {
            id: "answer-1",
            role: "assistant",
            content: "A completed answer",
            createdAt: "2026-10-11T00:01:00.000Z",
            status: "complete",
            generationRequestId: "request-1",
          },
        ]}
        provider={{ mode: "configured", label: "Tutor ready", guidance: "Ready" }}
        draft=""
        submitting={false}
        showProgress={false}
        error={null}
        onDraft={vi.fn()}
        onSubmit={vi.fn()}
        onRetry={vi.fn()}
        onKnowledge={vi.fn()}
        onInspectGeneration={inspect}
        pipeline={null}
        recovery={null}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "View generation details" }));
    expect(inspect).toHaveBeenCalledWith("request-1");
  });

  it("scrolls when progress starts and an answer arrives without following elapsed ticks", () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
    const messages = [
      {
        id: "message-1",
        role: "user",
        content: "An earlier question",
        createdAt: "2026-10-11T00:00:00.000Z",
        status: "complete",
      },
    ] as const;
    const properties = {
      provider: { mode: "configured", label: "Tutor ready", guidance: "Ready" } as const,
      draft: "A follow-up idea",
      error: null,
      onDraft: vi.fn(),
      onSubmit: vi.fn(),
      onRetry: vi.fn(),
      onKnowledge: vi.fn(),
      recovery: null,
    } as const;
    const { rerender } = render(
      <Conversation {...properties} messages={messages} submitting={false} showProgress={false} />,
    );
    scrollIntoView.mockClear();

    rerender(
      <Conversation {...properties} messages={messages} submitting={true} showProgress={true} />,
    );
    expect(scrollIntoView).toHaveBeenCalledOnce();

    act(() => vi.advanceTimersByTime(3_000));
    expect(scrollIntoView).toHaveBeenCalledOnce();

    rerender(
      <Conversation
        {...properties}
        messages={[
          ...messages,
          {
            id: "message-2",
            role: "assistant",
            content: "A completed answer",
            createdAt: "2026-10-11T00:01:00.000Z",
            status: "complete",
          },
        ]}
        submitting={false}
        showProgress={false}
      />,
    );
    expect(scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it("keeps an editable draft while one tutor response is in progress", () => {
    vi.useFakeTimers();
    const submit = vi.fn();
    const { rerender } = render(
      <Conversation
        messages={[]}
        provider={{ mode: "configured", label: "Tutor ready", guidance: "Ready" }}
        draft="A follow-up idea"
        submitting={true}
        showProgress={true}
        error={null}
        onDraft={vi.fn()}
        onSubmit={submit}
        onRetry={vi.fn()}
        onKnowledge={vi.fn()}
        recovery={null}
      />,
    );

    expect(screen.getByRole("status").textContent).toContain("Preparing your answer");
    expect(screen.getByRole("textbox", { name: "Ask your tutor" }).hasAttribute("disabled")).toBe(
      false,
    );
    expect(screen.getByRole("button", { name: "Sending message" }).hasAttribute("disabled")).toBe(
      true,
    );
    fireEvent.keyDown(screen.getByRole("textbox", { name: "Ask your tutor" }), {
      key: "Enter",
      ctrlKey: true,
    });
    expect(submit).not.toHaveBeenCalled();

    act(() => vi.advanceTimersByTime(65_000));
    const elapsed = screen.getByText("Elapsed 1:05");
    expect(elapsed.getAttribute("aria-hidden")).toBe("true");

    rerender(
      <Conversation
        messages={[]}
        provider={{ mode: "configured", label: "Tutor ready", guidance: "Ready" }}
        draft="A follow-up idea"
        submitting={false}
        showProgress={false}
        error={null}
        onDraft={vi.fn()}
        onSubmit={submit}
        onRetry={vi.fn()}
        onKnowledge={vi.fn()}
        recovery={null}
      />,
    );
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: "Send message" }).hasAttribute("disabled")).toBe(
      false,
    );
  });

  it("keeps recovery as the only progress surface while submission stays locked", () => {
    render(
      <Conversation
        messages={[]}
        provider={{ mode: "configured", label: "Tutor ready", guidance: "Ready" }}
        draft="A follow-up idea"
        submitting={true}
        showProgress={false}
        error={null}
        onDraft={vi.fn()}
        onSubmit={vi.fn()}
        onRetry={vi.fn()}
        onKnowledge={vi.fn()}
        recovery={<div role="status">Saved request is still running</div>}
      />,
    );

    expect(screen.getAllByRole("status")).toHaveLength(1);
    expect(screen.queryByText("Preparing your answer")).toBeNull();
    expect(screen.getByRole("button", { name: "Sending message" }).hasAttribute("disabled")).toBe(
      true,
    );
  });
});
