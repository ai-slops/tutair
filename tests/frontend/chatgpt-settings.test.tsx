// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../../src/client/components/Dialogs";

afterEach(cleanup);

describe("ChatGPT account settings", () => {
  it("offers the local bridge without exposing credentials when disconnected", () => {
    renderDialog({ enabled: true, connected: false, selectedModel: null, models: [] });

    const connect = screen.getByRole("link", { name: "Connect ChatGPT" });
    expect(connect.getAttribute("href")).toBe("/api/chatgpt/connect");
    expect(document.body.textContent).not.toContain("token");
  });

  it("selects an account-visible model and disconnects the learner connection", async () => {
    const selectModel = vi.fn(() => Promise.resolve(true));
    const disconnect = vi.fn(() => Promise.resolve(true));
    const user = userEvent.setup();
    renderDialog(
      {
        enabled: true,
        connected: true,
        selectedModel: "gpt-one",
        models: [
          { slug: "gpt-one", displayName: "GPT One" },
          { slug: "gpt-two", displayName: "GPT Two" },
        ],
      },
      selectModel,
      disconnect,
    );

    await user.selectOptions(screen.getByLabelText("ChatGPT model"), "gpt-two");
    await user.click(screen.getByRole("button", { name: "Disconnect ChatGPT" }));

    expect(selectModel).toHaveBeenCalledWith("gpt-two");
    expect(disconnect).toHaveBeenCalledOnce();
  });
});

function renderDialog(
  chatgpt: {
    readonly enabled: boolean;
    readonly connected: boolean;
    readonly selectedModel: string | null;
    readonly models: readonly { readonly slug: string; readonly displayName: string }[];
  },
  onSelectModel = vi.fn(() => Promise.resolve(true)),
  onDisconnect = vi.fn(() => Promise.resolve(true)),
) {
  return render(
    <Dialog
      kind="settings"
      provider={{ mode: "unavailable", label: "Model unavailable", guidance: "Choose a model." }}
      chatgpt={chatgpt}
      busy={false}
      correction=""
      correctionKind="revise"
      onCorrection={vi.fn()}
      onCorrectionKind={vi.fn()}
      onClose={vi.fn()}
      onConfirm={vi.fn()}
      onSelectChatGptModel={onSelectModel}
      onDisconnectChatGpt={onDisconnect}
    />,
  );
}
