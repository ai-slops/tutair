// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { AnswerProvenance } from "../../src/client/components/AnswerProvenance";
import type { AnswerProvenanceRecord } from "../../src/client/provenance-contract";

const record: AnswerProvenanceRecord = {
  availability: "available",
  reason: null,
  providedToModel: [
    {
      knowledgeId: "knowledge-1",
      revisionId: "revision-1",
      revision: 2,
      title: "Finite-state machine",
      scope: "canonical",
      href: "/?view=knowledge&knowledge=knowledge-1&revision=2",
      stages: ["planning", "final"],
    },
  ],
  created: [
    {
      knowledgeId: "knowledge-2",
      revisionId: "revision-2",
      revision: 1,
      title: "Transition guard",
      scope: "provisional",
      href: "/?view=knowledge&knowledge=knowledge-2&revision=1",
      stages: [],
    },
  ],
  createdDocuments: [
    {
      documentId: "document-1",
      knowledgeId: "knowledge-2",
      knowledgeRevisionId: "revision-2",
      role: "localization",
      languageTag: "ko",
    },
  ],
  exposedInAnswer: [],
  exposureCoverage: "non_exhaustive",
  reasoningSummaries: [
    {
      runId: "run-1",
      stage: "final",
      state: "available",
      text: "Compared the exact revision with the requested example.",
    },
  ],
};

afterEach(cleanup);

it("keeps the provenance control visible and loads exact revision links only when expanded", async () => {
  // Given
  const load = vi.fn().mockResolvedValue(record);
  render(<AnswerProvenance requestId="request-1" load={load} />);

  // When
  fireEvent.click(screen.getByRole("button", { name: "Sources & knowledge" }));

  // Then
  await waitFor(() => expect(load).toHaveBeenCalledOnce());
  const provided = screen.getByRole("region", { name: "Provided to model" });
  const link = within(provided).getByRole("link", { name: /Finite-state machine/ });
  expect(link.getAttribute("href")).toBe("/?view=knowledge&knowledge=knowledge-1&revision=2");
  expect(screen.getByText("Created during this answer")).toBeDefined();
  expect(screen.getByText(/annotations are not exhaustive/i)).toBeDefined();
  expect(screen.getByText("Provider reasoning summary")).toBeDefined();
  expect(screen.getByText(/Compared the exact revision/)).toBeDefined();
});

it("shows explicit historical unavailability without calling an endpoint", () => {
  // Given
  const load = vi.fn().mockResolvedValue(record);

  // When
  render(<AnswerProvenance requestId={undefined} load={load} />);

  // Then
  expect(screen.getByText(/unavailable for this historical answer/i)).toBeDefined();
  expect(load).not.toHaveBeenCalled();
});
