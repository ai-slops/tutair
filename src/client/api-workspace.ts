import { HTTPError, type KyInstance } from "ky";
import { z } from "zod";
import {
  CapabilitiesSchema,
  ChatGptModelsSchema,
  ConversationDetailSchema,
  ConversationsSchema,
  mapConversation,
  mapMessage,
  providerFrom,
  request,
  SignupSchema,
} from "./api-contract";
import { loadKnowledge } from "./api-knowledge";
import {
  candidateIds,
  LearningThreadDetailSchema,
  LearningThreadsSchema,
} from "./learning-contract";
import type { TurnRecovery } from "./learning-model";
import { DebugSettingsSchema } from "./provenance-contract";
import type { WorkspaceSnapshot } from "./workspace";

export class WorkspaceClient {
  activeConversationId: string | null = null;
  activeLearningThreadId: string | null = null;
  readonly recoveries = new Map<string, TurnRecovery>();
  readonly completedRequests = new Map<string, Set<string>>();
  private generation = 0;
  private learnerId: string | null = null;

  constructor(readonly http: KyInstance) {
    if (typeof window !== "undefined") {
      const query = new URL(window.location.href).searchParams.get("conversation");
      const parsed = z.uuid().safeParse(query);
      this.activeConversationId = parsed.success ? parsed.data : null;
    }
  }

  begin(): number {
    return ++this.generation;
  }
  select(generation: number, id: string | null): void {
    if (generation !== this.generation) return;
    this.activeConversationId = id;
    this.activeLearningThreadId = null;
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      if (id === null) url.searchParams.delete("conversation");
      else url.searchParams.set("conversation", id);
      window.history.replaceState(null, "", url);
    }
  }

  async ensureSession(): Promise<void> {
    let learnerId: string;
    try {
      const session = await request(
        () => this.http.get("session").json(),
        z.object({ learner: z.object({ id: z.string() }) }),
      );
      learnerId = session.learner.id;
    } catch (cause) {
      const httpError =
        cause instanceof Error && cause.cause instanceof HTTPError ? cause.cause : cause;
      if (!(httpError instanceof HTTPError) || httpError.response.status !== 401) throw cause;
      const signup = await request(
        () =>
          this.http.post("auth/local-signup", { json: { displayName: "Local learner" } }).json(),
        SignupSchema,
      );
      learnerId = signup.learner.id;
    }
    if (this.learnerId !== null && this.learnerId !== learnerId) {
      this.activeConversationId = null;
      this.activeLearningThreadId = null;
      this.recoveries.clear();
      this.completedRequests.clear();
    }
    this.learnerId = learnerId;
  }

  async snapshot(
    conversationId = this.activeConversationId,
    generation = this.generation,
  ): Promise<WorkspaceSnapshot> {
    await this.ensureSession();
    const [capabilities, conversations, threads, knowledge, debugSettings] = await Promise.all([
      request(() => this.http.get("capabilities").json(), CapabilitiesSchema),
      request(() => this.http.get("conversations").json(), ConversationsSchema),
      request(() => this.http.get("threads").json(), LearningThreadsSchema),
      loadKnowledge(this.http),
      request(() => this.http.get("settings/debug").json(), DebugSettingsSchema),
    ]);
    const detail =
      conversationId === null
        ? null
        : await request(
            () => this.http.get(`conversations/${conversationId}`).json(),
            ConversationDetailSchema,
          );
    const threadId = detail?.currentThreadId ?? null;
    const thread =
      threadId === null
        ? null
        : await request(
            () => this.http.get(`threads/${threadId}`).json(),
            LearningThreadDetailSchema,
          );
    const latestTurn = detail?.turnOutcomes.at(-1);
    if (generation === this.generation && conversationId !== null && detail !== null) {
      this.completedRequests.set(
        conversationId,
        new Set(
          detail.turnOutcomes
            .filter((turn) => turn.state === "completed")
            .map((turn) => turn.requestId),
        ),
      );
    }
    const pending = latestTurn?.state === "completed" ? undefined : latestTurn;
    if (generation === this.generation && conversationId !== null && pending !== undefined) {
      this.recoveries.set(conversationId, {
        requestId: pending.requestId,
        conversationId,
        userMessageId: pending.userMessageId,
        content: pending.content,
        kind:
          pending.state === "needs_selection"
            ? "selection"
            : pending.state === "running"
              ? "running"
              : "failed",
        candidateThreadIds: candidateIds(pending.error?.details ?? {}),
        message: pending.error?.message ?? "Your message is saved and the tutor is still working.",
      });
    }
    const local = conversationId === null ? undefined : this.recoveries.get(conversationId);
    if (
      generation === this.generation &&
      conversationId !== null &&
      local !== undefined &&
      detail?.turnOutcomes.some(
        (turn) => turn.requestId === local.requestId && turn.state === "completed",
      )
    ) {
      this.recoveries.delete(conversationId);
    }
    if (generation === this.generation) this.activeLearningThreadId = threadId;
    const trackingByMessage = new Map(
      detail?.turnOutcomes.flatMap((turn) =>
        turn.state === "completed" && turn.tutorMessageId !== null && turn.run !== null
          ? [[turn.tutorMessageId, turn.run] as const]
          : [],
      ) ?? [],
    );
    const requestByTutorMessage = new Map(
      detail?.turnOutcomes.flatMap((turn) =>
        turn.tutorMessageId === null ? [] : [[turn.tutorMessageId, turn.requestId] as const],
      ) ?? [],
    );
    const chatgptModels = capabilities.chatgpt.connected
      ? await request(() => this.http.get("chatgpt/models").json(), ChatGptModelsSchema)
      : { models: [] };
    return {
      conversations: conversations.conversations.map(mapConversation),
      activeConversationId: detail?.conversation.id ?? null,
      learningThreads: threads.threads,
      activeLearningThread:
        thread === null ? null : { ...thread.thread, questions: thread.openQuestions },
      recovery: conversationId === null ? null : (this.recoveries.get(conversationId) ?? null),
      messages:
        detail?.messages.map((record) => {
          const tracking = trackingByMessage.get(record.id);
          const generationRequestId = requestByTutorMessage.get(record.id);
          return {
            ...mapMessage(record),
            ...(tracking === undefined ? {} : { tracking }),
            ...(generationRequestId === undefined ? {} : { generationRequestId }),
          };
        }) ?? [],
      knowledge,
      provider: providerFrom(capabilities),
      chatgpt: {
        enabled: capabilities.chatgpt.enabled,
        connected: capabilities.chatgpt.connected,
        manualCallback: capabilities.chatgpt.manualCallback,
        selectedModel: capabilities.chatgpt.selectedModel ?? null,
        models: chatgptModels.models,
      },
      debugSettings,
    };
  }
}
