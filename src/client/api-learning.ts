import { z } from "zod";
import { ConversationSchema, request } from "./api-contract";
import type { WorkspaceClient } from "./api-workspace";
import {
  LearningThreadDetailSchema,
  LearningThreadSchema,
  QuestionSchema,
} from "./learning-contract";
import type { LearningThreadInput, LearningThreadStatus, QuestionStatus } from "./learning-model";

export function learningActions(workspace: WorkspaceClient) {
  const updatedThread = z.object({ thread: LearningThreadSchema });
  return {
    async createLearningThread(input: LearningThreadInput) {
      const generation = workspace.begin();
      let conversationId = workspace.activeConversationId;
      await workspace.ensureSession();
      if (conversationId === null) {
        const created = await request(
          () =>
            workspace.http
              .post("conversations", {
                json: { title: input.title, goal: input.desiredOutcome.slice(0, 1000) },
              })
              .json(),
          z.object({ conversation: ConversationSchema }),
        );
        conversationId = created.conversation.id;
      }
      await request(
        () =>
          workspace.http
            .post("threads", {
              json: { ...input, whyNow: input.whyNow.trim() || null, conversationId },
            })
            .json(),
        updatedThread,
      );
      workspace.select(generation, conversationId);
      return workspace.snapshot(conversationId, generation);
    },
    async openSearchThread(id: string) {
      const generation = workspace.begin();
      await workspace.ensureSession();
      const detail = await request(
        () => workspace.http.get(`threads/${id}`).json(),
        LearningThreadDetailSchema,
      );
      const linkedId = detail.thread.conversationId ?? detail.conversations.at(-1)?.id;
      const resumed = await request(
        () =>
          workspace.http
            .post(`threads/${id}/resume`, {
              json: linkedId === undefined ? {} : { conversationId: linkedId },
            })
            .json(),
        z.object({ conversation: ConversationSchema }),
      );
      workspace.select(generation, resumed.conversation.id);
      return workspace.snapshot(resumed.conversation.id, generation);
    },
    async updateLearningThread(id: string, input: LearningThreadInput) {
      const generation = workspace.begin();
      const conversationId = workspace.activeConversationId;
      await request(
        () =>
          workspace.http
            .patch(`threads/${id}`, {
              json: { ...input, whyNow: input.whyNow.trim() || null },
            })
            .json(),
        updatedThread,
      );
      return workspace.snapshot(conversationId, generation);
    },
    async setThreadStatus(id: string, status: LearningThreadStatus) {
      const generation = workspace.begin();
      const conversationId = workspace.activeConversationId;
      await request(
        () => workspace.http.patch(`threads/${id}`, { json: { status } }).json(),
        updatedThread,
      );
      return workspace.snapshot(conversationId, generation);
    },
    async addQuestion(id: string, text: string) {
      const generation = workspace.begin();
      const conversationId = workspace.activeConversationId;
      await request(
        () => workspace.http.post(`threads/${id}/questions`, { json: { text } }).json(),
        z.object({ question: QuestionSchema }),
      );
      return workspace.snapshot(conversationId, generation);
    },
    async setQuestionStatus(id: string, questionId: string, status: QuestionStatus) {
      const generation = workspace.begin();
      const conversationId = workspace.activeConversationId;
      await request(
        () =>
          workspace.http
            .patch(`threads/${id}/questions/${questionId}`, { json: { status } })
            .json(),
        z.object({ question: QuestionSchema }),
      );
      return workspace.snapshot(conversationId, generation);
    },
    async promoteKnowledge(id: string, knowledgeId: string) {
      const generation = workspace.begin();
      const conversationId = workspace.activeConversationId;
      const detail = await request(
        () => workspace.http.get(`threads/${id}`).json(),
        LearningThreadDetailSchema,
      );
      await request(
        () =>
          workspace.http
            .patch(`threads/${id}`, {
              json: {
                targetKnowledgeUnitIds: [
                  ...new Set([...detail.thread.targetKnowledgeUnitIds, knowledgeId]),
                ],
              },
            })
            .json(),
        updatedThread,
      );
      return workspace.snapshot(conversationId, generation);
    },
  };
}
