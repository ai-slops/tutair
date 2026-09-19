import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { CapabilitiesSchema } from "../../src/client/api-contract";
import { Dialog } from "../../src/client/components/Dialogs";
import { KnowledgePanel } from "../../src/client/components/KnowledgePanel";
import type { KnowledgeItem } from "../../src/client/model";

describe("client runtime contracts", () => {
  it("accepts the disabled-provider capabilities payload", () => {
    const parsed = CapabilitiesSchema.parse({
      provider: "disabled",
      model: null,
      generation: false,
      embedding: false,
      search: true,
      searchMode: "fts-only",
      synthetic: false,
    });

    expect(parsed.model).toBeNull();
  });

  it("offers an inspection control for an exposure-only concept", () => {
    const exposureOnly: KnowledgeItem = {
      id: "concept-1",
      name: "Bayes theorem",
      definition: "A rule for updating conditional probability.",
      revision: 1,
      sources: [],
      evidence: [
        {
          id: "exposure-1",
          dimension: null,
          summary: "Tutor exposure recorded — not mastery evidence",
          source: "Tutor explanation exposure",
          createdAt: "2026-09-19T19:00:00.000Z",
        },
      ],
      learnerState: [],
    };

    const markup = renderToStaticMarkup(
      <KnowledgePanel
        open
        items={[exposureOnly]}
        selected={null}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onCorrect={vi.fn()}
      />,
    );

    expect(markup).toContain("Inspect Bayes theorem");
  });

  it("offers claim-less correction intent without inferring it from prose", () => {
    const markup = renderToStaticMarkup(
      <Dialog
        kind="correction"
        provider={{ mode: "configured", label: "Provider", guidance: "Available" }}
        busy={false}
        correction="Use a narrower definition."
        correctionKind="claim_less"
        onCorrection={vi.fn()}
        onCorrectionKind={vi.fn()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
      />,
    );

    expect(markup).toContain('value="claim_less" selected=""');
  });
});
