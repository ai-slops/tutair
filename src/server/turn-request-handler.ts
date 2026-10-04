import { z } from "zod";
import type { TutorTurnRequest } from "./turn-request-schema.js";
import type { TurnRequestRecord, TurnRequestStore } from "./turn-request-store.js";
import type { LearnerId } from "./types.js";
import { ApiError } from "./types.js";

type PrepareInput = {
  readonly store: TurnRequestStore;
  readonly owner: LearnerId;
  readonly conversationId: string;
  readonly requestId: string;
  readonly baseHash: string;
  readonly body: TutorTurnRequest;
};
export type TurnRequestPreparation =
  | { readonly kind: "new"; readonly requestId: string }
  | { readonly kind: "resume"; readonly requestId: string; readonly userMessageId: string }
  | { readonly kind: "completed"; readonly response: Readonly<Record<string, unknown>> };

const errorDetails = z.record(z.string(), z.string());
const cachedResponse = z.record(z.string(), z.unknown());

const cachedError = (record: TurnRequestRecord): ApiError => {
  const status = record.error_status;
  const code = record.error_code;
  const message = record.error_message;
  if (status === null || code === null || message === null)
    return new ApiError(500, "turn_request_corrupt", "Stored tutor turn outcome is incomplete");
  const details =
    record.error_details_json === null
      ? undefined
      : errorDetails.parse(JSON.parse(record.error_details_json));
  return new ApiError(status, code, message, details);
};

export const prepareTurnRequest = (input: PrepareInput): TurnRequestPreparation => {
  const existing = input.store.get(input.owner, input.conversationId, input.requestId);
  if (existing === null) return { kind: "new", requestId: input.requestId };
  if (existing.base_hash !== input.baseHash)
    throw new ApiError(409, "turn_request_conflict", "Request ID is already bound to other input", {
      requestId: input.requestId,
      userMessageId: existing.user_message_id,
    });
  switch (existing.state) {
    case "running":
      throw new ApiError(409, "turn_request_in_progress", "Tutor turn request is still running", {
        requestId: input.requestId,
        userMessageId: existing.user_message_id,
      });
    case "completed": {
      if (existing.response_json === null)
        throw new ApiError(500, "turn_request_corrupt", "Stored tutor turn response is incomplete");
      const response = cachedResponse.parse(JSON.parse(existing.response_json));
      return { kind: "completed", response };
    }
    case "failed":
      throw cachedError(existing);
    case "needs_selection":
      if (input.body.threadId === undefined && input.body.newThread !== true)
        throw cachedError(existing);
      return {
        kind: "resume",
        requestId: input.requestId,
        userMessageId: existing.user_message_id,
      };
  }
};
