import { z } from "zod";
import { ApiError, ConversationSchema, request, TutorTurnSchema } from "./api-contract";
import type { WorkspaceClient } from "./api-workspace";
import type { GenerationTarget } from "./generation-contract";
import { candidateIds, LearningThreadDetailSchema } from "./learning-contract";
import type { RecoveryChoice, TurnRecovery } from "./learning-model";

export function turnActions(workspace: WorkspaceClient) {
  async function submit(
    attempt: TurnRecovery,
    choice: RecoveryChoice | undefined,
    generation: number,
    onStarted?: (target: GenerationTarget) => void,
  ) {
    workspace.select(generation, attempt.conversationId);
    workspace.recoveries.set(attempt.conversationId, { ...attempt, kind: "running" });
    onStarted?.({ conversationId: attempt.conversationId, requestId: attempt.requestId });
    try {
      await request(
        () =>
          workspace.http
            .post(`conversations/${attempt.conversationId}/tutor-turn`, {
              json: { content: attempt.content, requestId: attempt.requestId, ...choice },
              timeout: 300_000,
            })
            .json(),
        TutorTurnSchema,
      );
      workspace.recoveries.delete(attempt.conversationId);
      return await workspace.snapshot(attempt.conversationId, generation);
    } catch (cause) {
      if (!(cause instanceof Error)) throw cause;
      const code = cause instanceof ApiError ? cause.code : "network_error";
      const details = cause instanceof ApiError ? cause.details : {};
      const selection = code === "thread_selection_ambiguous" || code === "thread_not_open";
      workspace.recoveries.set(attempt.conversationId, {
        ...attempt,
        userMessageId: details["userMessageId"] ?? attempt.userMessageId,
        kind: selection
          ? "selection"
          : code === "turn_in_progress" || code === "turn_request_in_progress"
            ? "running"
            : cause instanceof ApiError && details["userMessageId"] !== undefined
              ? "failed"
              : "unknown",
        candidateThreadIds: candidateIds(details),
        message: cause.message,
      });
      if (!(cause instanceof ApiError)) {
        try {
          const recovered = await workspace.snapshot(attempt.conversationId, generation);
          if (workspace.completedRequests.get(attempt.conversationId)?.has(attempt.requestId))
            return recovered;
        } catch (recoveryCause) {
          if (!(recoveryCause instanceof Error)) throw recoveryCause;
        }
      }
      throw cause;
    }
  }

  function pending(): TurnRecovery {
    const id = workspace.activeConversationId;
    const attempt = id === null ? undefined : workspace.recoveries.get(id);
    if (attempt === undefined)
      throw new ApiError("turn_not_pending", "There is no saved request to continue.");
    return attempt;
  }

  return {
    async sendMessage(
      conversationId: string | null,
      content: string,
      onStarted?: (target: GenerationTarget) => void,
    ) {
      const generation = workspace.begin();
      const selectedThreadId =
        conversationId === workspace.activeConversationId ? workspace.activeLearningThreadId : null;
      await workspace.ensureSession();
      let id = conversationId;
      if (id === null) {
        const created = await request(
          () =>
            workspace.http.post("conversations", { json: { goal: content.slice(0, 120) } }).json(),
          z.object({ conversation: ConversationSchema }),
        );
        id = created.conversation.id;
      }
      const prior = workspace.recoveries.get(id);
      if (prior?.content === content && (prior.kind === "selection" || prior.kind === "failed"))
        throw new ApiError(
          "saved_turn_requires_action",
          "This question is already saved. Resolve it above or ask a different question.",
        );
      const attempt: TurnRecovery =
        prior?.content === content
          ? prior
          : {
              requestId: crypto.randomUUID(),
              conversationId: id,
              content,
              userMessageId: null,
              kind: "running",
              candidateThreadIds: [],
              message: "Waiting for the tutor.",
            };
      return submit(
        attempt,
        selectedThreadId === null ? undefined : { threadId: selectedThreadId },
        generation,
        onStarted,
      );
    },
    async resolveTurn(choice: RecoveryChoice, onStarted?: (target: GenerationTarget) => void) {
      const attempt = pending();
      const generation = workspace.begin();
      if ("threadId" in choice) {
        const detail = await request(
          () => workspace.http.get(`threads/${choice.threadId}`).json(),
          LearningThreadDetailSchema,
        );
        if (detail.thread.status !== "open") {
          await request(
            () =>
              workspace.http
                .post(`threads/${choice.threadId}/resume`, {
                  json: { conversationId: attempt.conversationId },
                })
                .json(),
            z.object({ conversation: ConversationSchema }),
          );
        }
      }
      return submit(attempt, choice, generation, onStarted);
    },
    retryTurn(onStarted?: (target: GenerationTarget) => void) {
      const attempt = pending();
      if (attempt.kind === "failed" || attempt.kind === "selection")
        throw new ApiError(
          "turn_not_retryable",
          "Choose a learning thread or ask a new question; the saved request will not be repeated.",
        );
      return submit(attempt, undefined, workspace.begin(), onStarted);
    },
  };
}
