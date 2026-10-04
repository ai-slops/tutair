// @vitest-environment jsdom
import ky from "ky";
import { beforeEach, describe, expect, it } from "vitest";
import { WorkspaceClient } from "../../src/client/api-workspace";

describe("conversation location", () => {
  beforeEach(() => window.history.replaceState(null, "", "/"));

  it("restores a selected conversation after a page reload without confusing thread IDs", () => {
    const id = crypto.randomUUID();
    const workspace = new WorkspaceClient(ky.create());
    workspace.select(workspace.begin(), id);
    const reloaded = new WorkspaceClient(ky.create());
    expect(reloaded.activeConversationId).toBe(id);
    expect(reloaded.activeLearningThreadId).toBeNull();
  });

  it("does not let stale selection change the URL and clears it for erased data", () => {
    const workspace = new WorkspaceClient(ky.create());
    const older = workspace.begin();
    const newer = workspace.begin();
    const id = crypto.randomUUID();
    workspace.select(newer, id);
    workspace.select(older, crypto.randomUUID());
    expect(new URL(window.location.href).searchParams.get("conversation")).toBe(id);
    workspace.select(workspace.begin(), null);
    expect(new URL(window.location.href).searchParams.has("conversation")).toBe(false);
  });

  it("ignores a malformed conversation location rather than treating it as an API path", () => {
    window.history.replaceState(null, "", "/?conversation=..%2Fprivacy");
    expect(new WorkspaceClient(ky.create()).activeConversationId).toBeNull();
  });
});
