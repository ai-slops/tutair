import ky, { HTTPError } from "ky";
import { z } from "zod";
import {
  CapabilitiesSchema,
  ConversationDetailSchema,
  ConversationSchema,
  ConversationsSchema,
  dimensionFor,
  IdSchema,
  KnowledgeDetailSchema,
  KnowledgeListSchema,
  mapMessage,
  mapThread,
  providerFrom,
  RevisionSchema,
  request,
  SearchResponseSchema,
  SignupSchema,
  ThreadDetailSchema,
  ThreadResumeSchema,
  TutorTurnSchema,
} from "./api-contract";
import { DIMENSION_LABELS, type Evidence, type KnowledgeItem } from "./model";
import type { WorkspaceApi, WorkspaceSnapshot } from "./workspace";

const client = ky.create({
  prefixUrl: "api",
  credentials: "same-origin",
  timeout: 30_000,
  retry: { limit: 1, methods: ["get"] },
});
let activeConversationId: string | null = null;
let selectionGeneration = 0;

function beginSelectionOperation(): number {
  selectionGeneration += 1;
  return selectionGeneration;
}

function selectConversation(generation: number, conversationId: string | null): void {
  if (generation === selectionGeneration) activeConversationId = conversationId;
}

async function ensureSession(): Promise<void> {
  try {
    await client.get("session");
  } catch (cause) {
    if (cause instanceof HTTPError && cause.response.status === 401) {
      await request(
        () => client.post("auth/local-signup", { json: { displayName: "Local learner" } }).json(),
        SignupSchema,
      );
      return;
    }
    throw cause;
  }
}

async function loadKnowledge(): Promise<readonly KnowledgeItem[]> {
  const list = await request(
    () => client.get("knowledge", { searchParams: { scope: "all" } }).json(),
    KnowledgeListSchema,
  );
  return Promise.all(
    list.items.map(async (record) => {
      const detail = await request(
        () => client.get(`knowledge/${record.id}`).json(),
        KnowledgeDetailSchema,
      );
      const revision =
        detail.revisions.find((candidate) => candidate.revision === record.currentRevision) ??
        detail.revisions.at(-1);
      const evidence: readonly Evidence[] = [
        ...detail.evidence.map((item) => ({
          id: item.id,
          dimension: dimensionFor(item.dimension),
          summary:
            item.polarity === "negative"
              ? "Learner evidence needs review"
              : "Learner evidence recorded",
          source: `Learner message ${item.messageId}`,
          createdAt: item.createdAt,
        })),
        ...detail.exposures.map((item, index) => ({
          id: item.id || `${record.id}-exposure-${index}`,
          dimension: null,
          summary: "Tutor exposure recorded — not mastery evidence",
          source: "Tutor explanation exposure",
          createdAt: item.createdAt,
        })),
      ];
      const learnerState = detail.learnerState.map((state) => ({
        dimension: DIMENSION_LABELS[state.dimension],
        estimate: state.estimate,
        uncertainty: state.uncertainty,
        status: state.status,
        effectiveEvidence: state.effectiveEvidence,
        projectionVersion: state.projectionVersion,
        knowledgeRevisionId: state.knowledgeRevisionId,
        evidenceIds: state.evidenceIds,
      }));
      return {
        id: record.id,
        name: record.title,
        definition: revision?.statement ?? "No definition is available for this revision.",
        revision: record.currentRevision,
        sources:
          revision?.sourceRef === null || revision?.sourceRef === undefined
            ? []
            : [revision.sourceRef],
        evidence,
        learnerState,
      };
    }),
  );
}

async function snapshot(conversationId: string | null): Promise<WorkspaceSnapshot> {
  await ensureSession();
  const [capabilities, conversations, knowledge] = await Promise.all([
    request(() => client.get("capabilities").json(), CapabilitiesSchema),
    request(() => client.get("conversations").json(), ConversationsSchema),
    loadKnowledge(),
  ]);
  const selectedId = conversationId ?? activeConversationId;
  const detail =
    selectedId === null
      ? null
      : await request(
          () => client.get(`conversations/${selectedId}`).json(),
          ConversationDetailSchema,
        );
  return {
    threads: conversations.conversations.map(mapThread),
    activeThreadId: detail?.conversation.id ?? null,
    messages: detail?.messages.map(mapMessage) ?? [],
    knowledge,
    provider: providerFrom(capabilities),
  };
}

export const api: WorkspaceApi = {
  load() {
    beginSelectionOperation();
    return snapshot(activeConversationId);
  },
  async createThread() {
    const generation = beginSelectionOperation();
    await ensureSession();
    const created = await request(
      () => client.post("conversations", { json: {} }).json(),
      z.object({ conversation: ConversationSchema }),
    );
    selectConversation(generation, created.conversation.id);
    return snapshot(created.conversation.id);
  },
  openConversation(id) {
    const generation = beginSelectionOperation();
    selectConversation(generation, id);
    return snapshot(id);
  },
  async openSearchThread(id) {
    const generation = beginSelectionOperation();
    const thread = await request(() => client.get(`threads/${id}`).json(), ThreadDetailSchema);
    const linked = thread.conversations.at(-1);
    const conversation =
      linked ??
      (
        await request(
          () => client.post(`threads/${id}/resume`, { json: {} }).json(),
          ThreadResumeSchema,
        )
      ).conversation;
    selectConversation(generation, conversation.id);
    return snapshot(conversation.id);
  },
  async sendMessage(threadId, content) {
    const generation = beginSelectionOperation();
    let id = threadId;
    if (id === null) {
      const created = await request(
        () => client.post("conversations", { json: { goal: content.slice(0, 120) } }).json(),
        z.object({ conversation: ConversationSchema }),
      );
      id = created.conversation.id;
    }
    selectConversation(generation, id);
    await request(
      () =>
        client
          .post(`conversations/${id}/tutor-turn`, { json: { content }, timeout: 300_000 })
          .json(),
      TutorTurnSchema,
    );
    return snapshot(id);
  },
  async createSession() {
    beginSelectionOperation();
    await ensureSession();
    return snapshot(activeConversationId);
  },
  async correctKnowledge(itemId, correction, kind) {
    beginSelectionOperation();
    const items = await request(
      () => client.get(`knowledge/${itemId}`).json(),
      KnowledgeDetailSchema,
    );
    await request(
      () =>
        client
          .post("corrections", {
            json: {
              knowledgeId: itemId,
              revision: items.item.currentRevision,
              statement: correction,
              reason: "Learner correction",
              kind,
            },
          })
          .json(),
      z.object({ correction: z.object({ id: IdSchema }).passthrough(), revision: RevisionSchema }),
    );
    return snapshot(activeConversationId);
  },
  async deleteAll() {
    const generation = beginSelectionOperation();
    await client.delete("privacy");
    selectConversation(generation, null);
    return snapshot(null);
  },
  search: (query) =>
    request(
      () => client.get("search", { searchParams: { q: query, limit: 20 } }).json(),
      SearchResponseSchema,
    ),
  exportUrl: () => "/api/export",
};
