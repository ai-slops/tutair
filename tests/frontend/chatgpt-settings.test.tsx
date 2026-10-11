// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { Dialog } from "../../src/client/components/Dialogs";

afterEach(cleanup);

describe("ChatGPT account settings", () => {
  it("offers the local bridge without exposing credentials when disconnected", () => {
    renderDialog({
      enabled: true,
      connected: false,
      manualCallback: false,
      selectedModel: null,
      models: [],
    });

    const connect = screen.getByRole("link", { name: "Continue with ChatGPT" });
    expect(connect.getAttribute("href")).toBe("/api/chatgpt/connect");
    expect(document.body.textContent).not.toContain("token");
  });

  it("submits and clears a manual callback after successful completion", async () => {
    const complete = vi.fn(() => Promise.resolve(true));
    const user = userEvent.setup();
    renderDialog(
      {
        enabled: true,
        connected: false,
        manualCallback: true,
        selectedModel: null,
        models: [],
      },
      undefined,
      undefined,
      complete,
    );
    const callback = screen.getByLabelText("Full localhost callback URL");

    await user.type(callback, "http://127.0.0.1:1455/auth/callback?code=one&state=two");
    await user.click(screen.getByRole("button", { name: "Complete ChatGPT connection" }));

    await waitFor(() => {
      expect(complete).toHaveBeenCalledWith(
        "http://127.0.0.1:1455/auth/callback?code=one&state=two",
      );
      expect(inputValue(callback)).toBe("");
    });
  });

  it("keeps the manual callback available when completion fails", async () => {
    const complete = vi.fn(() => Promise.resolve(false));
    const user = userEvent.setup();
    renderDialog(
      {
        enabled: true,
        connected: false,
        manualCallback: true,
        selectedModel: null,
        models: [],
      },
      undefined,
      undefined,
      complete,
    );
    const callback = screen.getByLabelText("Full localhost callback URL");

    await user.type(callback, "http://127.0.0.1:1455/auth/callback?error=access_denied&state=two");
    await user.click(screen.getByRole("button", { name: "Complete ChatGPT connection" }));

    await waitFor(() => expect(complete).toHaveBeenCalledOnce());
    expect(inputValue(callback)).not.toBe("");
  });

  it("selects an account-visible model and disconnects the learner connection", async () => {
    const selectModel = vi.fn(() => Promise.resolve(true));
    const disconnect = vi.fn(() => Promise.resolve(true));
    const user = userEvent.setup();
    renderDialog(
      {
        enabled: true,
        connected: true,
        manualCallback: false,
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
    readonly manualCallback: boolean;
    readonly selectedModel: string | null;
    readonly models: readonly { readonly slug: string; readonly displayName: string }[];
  },
  onSelectModel = vi.fn(() => Promise.resolve(true)),
  onDisconnect = vi.fn(() => Promise.resolve(true)),
  onCompleteManual = vi.fn(() => Promise.resolve(true)),
  onBeginManual = vi.fn(() => Promise.resolve("https://auth.example/authorize")),
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
      onCompleteChatGptManual={onCompleteManual}
      onBeginChatGptManual={onBeginManual}
    />,
  );
}

function inputValue(element: HTMLElement): string {
  if (!(element instanceof HTMLInputElement)) throw new Error("Expected callback input");
  return element.value;
}
