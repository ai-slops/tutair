import ky, { type KyInstance } from "ky";
import { z } from "zod";
import {
  ConversationSchema,
  IdSchema,
  KnowledgeDetailSchema,
  RevisionSchema,
  request,
  SearchResponseSchema,
} from "./api-contract";
import { learningActions } from "./api-learning";
import { turnActions } from "./api-turns";
import { WorkspaceClient } from "./api-workspace";
import { GenerationPipelineSchema, GenerationRunDetailSchema } from "./generation-contract";
import { AnswerProvenanceSchema, DebugSettingsSchema } from "./provenance-contract";
import type { WorkspaceApi } from "./workspace";

export function createWorkspaceApi(client: KyInstance): WorkspaceApi {
  const workspace = new WorkspaceClient(client);
  return {
    load() {
      const generation = workspace.begin();
      return workspace.snapshot(workspace.activeConversationId, generation);
    },
    async createConversation() {
      const generation = workspace.begin();
      await workspace.ensureSession();
      const created = await request(
        () => client.post("conversations", { json: {} }).json(),
        z.object({ conversation: ConversationSchema }),
      );
      workspace.select(generation, created.conversation.id);
      return workspace.snapshot(created.conversation.id, generation);
    },
    openConversation(id) {
      const generation = workspace.begin();
      workspace.select(generation, id);
      return workspace.snapshot(id, generation);
    },
    ...learningActions(workspace),
    ...turnActions(workspace),
    async createSession() {
      const generation = workspace.begin();
      await workspace.ensureSession();
      return workspace.snapshot(workspace.activeConversationId, generation);
    },
    async correctKnowledge(itemId, correction, kind) {
      const generation = workspace.begin();
      const conversationId = workspace.activeConversationId;
      const detail = await request(
        () => client.get(`knowledge/${itemId}`).json(),
        KnowledgeDetailSchema,
      );
      await request(
        () =>
          client
            .post("corrections", {
              json: {
                knowledgeId: itemId,
                revision: detail.item.currentRevision,
                statement: correction,
                reason: "Learner correction",
                kind,
              },
            })
            .json(),
        z.object({
          correction: z.object({ id: IdSchema }).catchall(z.unknown()),
          revision: RevisionSchema,
        }),
      );
      return workspace.snapshot(conversationId, generation);
    },
    async reviewKnowledge(itemId, revision, action, reason, confirmed) {
      const generation = workspace.begin();
      const conversationId = workspace.activeConversationId;
      await request(
        () =>
          client
            .post(`knowledge/${itemId}/reviews`, {
              json: {
                revision,
                action,
                ...(reason.trim() === "" ? {} : { reason }),
                confirmed,
              },
            })
            .json(),
        z.object({ event: z.object({ id: IdSchema }).catchall(z.unknown()) }).catchall(z.unknown()),
      );
      return workspace.snapshot(conversationId, generation);
    },
    async deleteAll() {
      const generation = workspace.begin();
      await client.delete("privacy");
      workspace.recoveries.clear();
      workspace.completedRequests.clear();
      workspace.select(generation, null);
      return workspace.snapshot(null, generation);
    },
    async selectChatGptModel(slug) {
      const generation = workspace.begin();
      await client.put("chatgpt/model", { json: { slug } });
      return workspace.snapshot(workspace.activeConversationId, generation);
    },
    async beginChatGptManual() {
      const response = await request(
        () => client.post("chatgpt/manual/authorize").json(),
        z.object({ authorizationUrl: z.url() }),
      );
      return response.authorizationUrl;
    },
    async completeChatGptManual(callbackUrl) {
      const generation = workspace.begin();
      await client.post("chatgpt/manual/callback", { json: { callbackUrl } });
      return workspace.snapshot(workspace.activeConversationId, generation);
    },
    async disconnectChatGpt() {
      const generation = workspace.begin();
      await client.delete("chatgpt/connection");
      return workspace.snapshot(workspace.activeConversationId, generation);
    },
    async saveDebugSettings(value) {
      const generation = workspace.begin();
      await request(
        () => client.put("settings/debug", { json: value }).json(),
        DebugSettingsSchema,
      );
      return workspace.snapshot(workspace.activeConversationId, generation);
    },
    answerProvenance: (target) =>
      request(
        () =>
          client
            .get(
              `conversations/${target.conversationId}/tutor-turns/${target.requestId}/provenance`,
            )
            .json(),
        AnswerProvenanceSchema,
      ),
    search: (query) =>
      request(
        () => client.get("search", { searchParams: { q: query, limit: 20 } }).json(),
        SearchResponseSchema,
      ),
    generationPipeline: (target, signal) =>
      request(
        () =>
          client
            .get(
              `conversations/${target.conversationId}/tutor-turns/${target.requestId}/pipeline`,
              { signal },
            )
            .json(),
        GenerationPipelineSchema,
      ),
    generationRun: (target, runId, signal) =>
      request(
        () =>
          client
            .get(
              `conversations/${target.conversationId}/tutor-turns/${target.requestId}/pipeline/${runId}`,
              { signal },
            )
            .json(),
        GenerationRunDetailSchema,
      ),
    exportUrl: () => "/api/export",
  };
}

export const api = createWorkspaceApi(
  ky.create({
    prefixUrl: "api",
    credentials: "same-origin",
    timeout: 30_000,
    retry: { limit: 1, methods: ["get"] },
  }),
);
