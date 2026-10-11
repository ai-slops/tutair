import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createBackendHarness, type Json, post } from "./backend-harness.js";

describe("knowledge document routes", () => {
  const harness = createBackendHarness();
  beforeEach(harness.reset);
  afterEach(harness.cleanup);

  it("creates a localization linked to an exact English source block", async () => {
    const { client } = harness.setup();
    await client.call("/api/auth/local-signup", post({ displayName: "Ada" }));
    const conversation = await client.json("/api/conversations", post({}));
    const conversationId = (conversation.conversation as Json).id;
    await client.call(
      `/api/conversations/${conversationId}/tutor-turn`,
      post({ content: "Claim" }),
    );
    const list = await client.json("/api/knowledge?scope=all");
    const unit = (list["items"] as Json[])[0];
    if (unit === undefined) throw new Error("Expected prepared knowledge");
    const detail = await client.json(`/api/knowledge/${unit.id}`);
    const english = (detail["documents"] as Json[]).find(
      (document) => document["role"] === "english_base",
    );
    if (english === undefined) throw new Error("Expected English source document");
    const sourceBlock = (english["blocks"] as Json[])[0];
    if (sourceBlock === undefined) throw new Error("Expected English source block");

    const response = await client.call(
      `/api/knowledge/${unit.id}/revisions/${unit["currentRevision"]}/documents`,
      post({
        role: "localization",
        languageTag: "ko",
        baseDocumentId: english.id,
        sourceType: "model_generated",
        sourceRefs: [],
        blocks: [
          {
            type: "definition",
            content: "주장을 검증할 예시는 무엇인가요?",
            sourceBlockId: sourceBlock.id,
          },
        ],
      }),
    );

    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({ role: "localization", languageTag: "ko" });
  });
});
