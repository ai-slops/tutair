// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GenerationInspector } from "../../src/client/components/GenerationInspector";
import type {
  GenerationPipeline,
  GenerationRunDetail,
  GenerationStage,
} from "../../src/client/generation-contract";

const stage = (status: GenerationStage["status"]): GenerationStage => ({
  runId: "run-1",
  stage: "draft",
  status,
  attempt: 1,
  repairOfRunId: null,
  startedAt: "2026-10-11T00:00:00.000Z",
  finishedAt: status === "running" ? null : "2026-10-11T00:00:00.240Z",
  durationMs: status === "running" ? null : 240,
  provider: "chatgpt",
  model: "gpt-test",
  outputMode: "responses",
  usage: status === "running" ? null : { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
  errorCode: status === "failed" ? "schema_invalid" : null,
  fallbackStatus: status === "running" ? null : "repair_succeeded",
  versions: { stage: "v1", prompt: "p1", schema: "s1", context: "c1" },
  contextHash: "hash",
});

const pipeline = (status: GenerationStage["status"]): GenerationPipeline => ({
  requestId: "request-1",
  userMessageId: "message-1",
  tutorMessageId: null,
  state: status === "running" ? "running" : "completed",
  startedAt: "2026-10-11T00:00:00.000Z",
  finishedAt: status === "running" ? null : "2026-10-11T00:00:01.000Z",
  error: null,
  flags: null,
  stages: [stage(status)],
});

const detail = (status: GenerationStage["status"]): GenerationRunDetail => ({
  ...stage(status),
  recordedCall: { available: false, reason: "Unavailable" },
  response: { available: false, validated: false, value: null },
  traces: [],
});

afterEach(cleanup);

it("shows persisted duration, usage, error, and fallback metadata for a selected run", async () => {
  // Given
  render(
    <GenerationInspector
      open
      pipeline={pipeline("failed")}
      error={null}
      loadRun={vi.fn().mockResolvedValue(detail("failed"))}
      onClose={vi.fn()}
    />,
  );

  // When
  fireEvent.click(screen.getByRole("button", { name: "Inspect" }));

  // Then
  const heading = await screen.findByRole("heading", { name: "draft · attempt 1" });
  const runDetail = heading.parentElement;
  if (runDetail === null) throw new Error("Expected run detail section");
  expect(within(runDetail).getByText("240 ms")).toBeDefined();
  expect(within(runDetail).getByText("11 input / 7 output / 18 total")).toBeDefined();
  expect(within(runDetail).getByText("schema_invalid")).toBeDefined();
  expect(within(runDetail).getByText("repair_succeeded")).toBeDefined();
});

it("refreshes a selected running run when the pipeline records completion", async () => {
  // Given
  const loadRun = vi
    .fn<(runId: string, signal: AbortSignal) => Promise<GenerationRunDetail>>()
    .mockResolvedValueOnce(detail("running"))
    .mockResolvedValueOnce(detail("completed"));
  const { rerender } = render(
    <GenerationInspector
      open
      pipeline={pipeline("running")}
      error={null}
      loadRun={loadRun}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
  await waitFor(() => expect(loadRun).toHaveBeenCalledTimes(1));

  // When
  rerender(
    <GenerationInspector
      open
      pipeline={pipeline("completed")}
      error={null}
      loadRun={loadRun}
      onClose={vi.fn()}
    />,
  );

  // Then
  await waitFor(() => expect(loadRun).toHaveBeenCalledTimes(2));
  expect(await screen.findByText("11 input / 7 output / 18 total")).toBeDefined();
});

it("aborts an automatic run refresh when the inspector closes", async () => {
  // Given
  const refreshSignals: AbortSignal[] = [];
  const loadRun = vi
    .fn<(runId: string, signal: AbortSignal) => Promise<GenerationRunDetail>>()
    .mockResolvedValueOnce(detail("running"))
    .mockImplementationOnce((_runId, signal) => {
      refreshSignals.push(signal);
      return new Promise<GenerationRunDetail>(() => undefined);
    });
  const { rerender } = render(
    <GenerationInspector
      open
      pipeline={pipeline("running")}
      error={null}
      loadRun={loadRun}
      onClose={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole("button", { name: "Inspect" }));
  await waitFor(() => expect(loadRun).toHaveBeenCalledTimes(1));
  rerender(
    <GenerationInspector
      open
      pipeline={pipeline("completed")}
      error={null}
      loadRun={loadRun}
      onClose={vi.fn()}
    />,
  );
  await waitFor(() => expect(refreshSignals).toHaveLength(1));

  // When
  rerender(
    <GenerationInspector
      open={false}
      pipeline={pipeline("completed")}
      error={null}
      loadRun={loadRun}
      onClose={vi.fn()}
    />,
  );

  // Then
  expect(refreshSignals[0]?.aborted).toBe(true);
});
