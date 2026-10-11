// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { GenerationPipeline, GenerationTarget } from "../../src/client/generation-contract";
import { useGenerationPipeline } from "../../src/client/useGenerationPipeline";

const target: GenerationTarget = { conversationId: "conversation-1", requestId: "request-1" };
const pipeline = (
  state: GenerationPipeline["state"],
  requestId = target.requestId,
): GenerationPipeline => ({
  requestId,
  userMessageId: "message-1",
  tutorMessageId: null,
  state,
  startedAt: "2026-10-11T00:00:00.000Z",
  finishedAt: state === "running" ? null : "2026-10-11T00:00:02.000Z",
  error: null,
  flags: null,
  stages: [],
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("generation polling", () => {
  it("fetches immediately, polls active work every two seconds, and stops when terminal", async () => {
    vi.useFakeTimers();
    const load = vi
      .fn<(signal: AbortSignal) => Promise<GenerationPipeline>>()
      .mockResolvedValueOnce(pipeline("running"))
      .mockResolvedValueOnce(pipeline("completed"));
    renderHook(() => useGenerationPipeline(target, true, load));
    await act(async () => Promise.resolve());
    expect(load).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_000);
    });
    expect(load).toHaveBeenCalledTimes(2);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(4_000);
    });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it("aborts and discards stale work when the conversation changes", async () => {
    let resolveFirst = (_value: GenerationPipeline): void => undefined;
    const first = new Promise<GenerationPipeline>((resolve) => {
      resolveFirst = resolve;
    });
    const signals: AbortSignal[] = [];
    const load = vi.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length === 1 ? first : Promise.resolve(pipeline("completed", "request-2"));
    });
    const { rerender, result } = renderHook(
      ({ currentTarget }) => useGenerationPipeline(currentTarget, true, load),
      { initialProps: { currentTarget: target } },
    );
    await waitFor(() => expect(load).toHaveBeenCalledTimes(1));

    rerender({ currentTarget: { conversationId: "conversation-2", requestId: "request-2" } });
    await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
    expect(signals[0]?.aborted).toBe(true);
    resolveFirst(pipeline("running"));
    await act(async () => Promise.resolve());

    expect(result.current.pipeline?.requestId).toBe("request-2");
    expect(result.current.pipeline?.state).toBe("completed");
  });
});
