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
