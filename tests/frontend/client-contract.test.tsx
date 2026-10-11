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
      chatgpt: { enabled: false, connected: false },
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
        error={null}
        onClose={vi.fn()}
        onSelect={vi.fn()}
        onCorrect={vi.fn()}
      />,
    );

    expect(markup).toContain('<button class="concept-row" type="button" aria-pressed="false">');
    expect(markup).toContain("Bayes theorem");
  });

  it("offers claim-less correction intent without inferring it from prose", () => {
    const markup = renderToStaticMarkup(
      <Dialog
        kind="correction"
        provider={{ mode: "configured", label: "Provider", guidance: "Available" }}
        chatgpt={{
          enabled: false,
          connected: false,
          manualCallback: false,
          selectedModel: null,
          models: [],
        }}
        busy={false}
        correction="Use a narrower definition."
        correctionKind="claim_less"
        onCorrection={vi.fn()}
        onCorrectionKind={vi.fn()}
        onClose={vi.fn()}
        onConfirm={vi.fn()}
        onSelectChatGptModel={() => Promise.resolve(true)}
        onCompleteChatGptManual={() => Promise.resolve(true)}
        onDisconnectChatGpt={() => Promise.resolve(true)}
      />,
    );

    expect(markup).toContain('value="claim_less" selected=""');
  });
});
