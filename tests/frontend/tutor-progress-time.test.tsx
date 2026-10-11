// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { TutorProgress } from "../../src/client/components/TutorProgress";
import type { GenerationPipeline } from "../../src/client/generation-contract";

afterEach(() => {
  vi.useRealTimers();
  cleanup();
});

it("uses the persisted pipeline start time when it becomes available", () => {
  // Given
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-11T00:01:05.000Z"));
  const persisted: GenerationPipeline = {
    requestId: "request-1",
    userMessageId: "message-1",
    tutorMessageId: null,
    state: "running",
    startedAt: "2026-10-11T00:00:00.000Z",
    finishedAt: null,
    error: null,
    flags: null,
    stages: [],
  };
  const { rerender } = render(<TutorProgress pipeline={null} onInspect={vi.fn()} />);
  expect(screen.getByText("Elapsed 0:00")).toBeDefined();

  // When
  rerender(<TutorProgress pipeline={persisted} onInspect={vi.fn()} />);

  // Then
  expect(screen.getByText("Elapsed 1:05")).toBeDefined();
});
