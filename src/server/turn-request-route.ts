import type { Hono } from "hono";
import { z } from "zod";
import { jsonBody, ownerFor, type Services } from "./context.js";
import { prepareTurnRequest, type TurnRequestPreparation } from "./turn-request-handler.js";
import { turnRequestIdentity, tutorTurnRequestSchema } from "./turn-request-schema.js";
import { TurnRequestStore } from "./turn-request-store.js";
import type { LearnerId } from "./types.js";
import { ApiError } from "./types.js";

const sourceMessage = z.object({ id: z.string(), content: z.string() });
const responseMetadata = z.object({
  tutorMessage: z.object({ id: z.string() }),
  run: z.unknown(),
});

type TurnSourceInput = {
  readonly preparation: TurnRequestPreparation;
  readonly store: TurnRequestStore;
  readonly services: Services;
  readonly owner: LearnerId;
  readonly conversationId: string;
  readonly requestId: string;
  readonly baseHash: string;
  readonly content: string;
};

const sourceFor = (
  input: TurnSourceInput,
): { readonly userMessage: unknown; readonly id: string; readonly content: string } => {
  switch (input.preparation.kind) {
    case "completed":
      throw new ApiError(500, "turn_request_corrupt", "Completed request reached execution");
    case "resume": {
      input.store.markRunning(input.owner, input.conversationId, input.requestId);
      const userMessage = input.services.core.message(input.owner, input.preparation.userMessageId);
      const parsed = sourceMessage.parse(userMessage);
      return {
        userMessage,
        id: input.preparation.userMessageId,
        content: parsed.content,
      };
    }
    case "new":
      return input.services.db.transaction(() => {
        const userMessage = input.services.core.createMessage(
          input.owner,
          input.conversationId,
          "learner",
          input.content,
        );
        const parsed = sourceMessage.parse(userMessage);
        input.store.create({
          owner: input.owner,
          conversationId: input.conversationId,
          requestId: input.requestId,
          userMessageId: parsed.id,
          baseHash: input.baseHash,
        });
        return { userMessage, id: parsed.id, content: parsed.content };
      });
  }
};

export const registerTutorTurnRoute = (app: Hono, services: Services): void => {
  app.post("/conversations/:id/tutor-turn", async (c) => {
    await services.ready;
    if (services.runtime === undefined)
      throw new ApiError(500, "runtime_unavailable", "Execution runtime is unavailable");
    const owner = ownerFor(c, services);
    const conversationId = c.req.param("id");
    services.core.conversation(owner, conversationId);
    const body = tutorTurnRequestSchema.parse(await jsonBody(c));
    const identity = turnRequestIdentity(body);
    const store = new TurnRequestStore(services.db);
    const preparation = prepareTurnRequest({
      store,
      owner,
      conversationId,
      requestId: identity.requestId,
      baseHash: identity.baseHash,
      body,
    });
    if (preparation.kind === "completed") return c.json(preparation.response, 201);
    const cutoff = Date.now() - 60_000;
    const attempts = (services.turnAttempts.get(owner) ?? []).filter((time) => time > cutoff);
    if (attempts.length >= 20)
      throw new ApiError(429, "rate_limited", "Tutor turn rate limit exceeded");
    const lock = `${owner}:${conversationId}`;
    if (services.turnLocks.has(lock))
      throw new ApiError(409, "turn_in_progress", "A tutor turn is already running");
    attempts.push(Date.now());
    services.turnAttempts.set(owner, attempts);
    services.turnLocks.add(lock);
    let sourceId: string | undefined;
    try {
      const source = sourceFor({
        preparation,
        store,
        services,
        owner,
        conversationId,
        requestId: identity.requestId,
        baseHash: identity.baseHash,
        content: body.content,
      });
      sourceId = source.id;
      const managed = await services.runtime.turn({
        owner,
        requestId: identity.requestId,
        deadlineMs: 300_000,
        onStarted: (operationId) =>
          store.attachRuntime({
            owner,
            conversationId,
            requestId: identity.requestId,
            operationId,
          }),
        body: (runtimeContext) =>
          services.tutor.turn(
            {
              owner,
              conversationId,
              messageId: source.id,
              content: source.content,
              assistance: body.assistance,
              selfReport: body.selfReport,
              ...(body.confidence === undefined ? {} : { confidence: body.confidence }),
              ...(body.threadId === undefined ? {} : { threadId: body.threadId }),
              ...(body.newThread === undefined ? {} : { newThread: body.newThread }),
              ...(body.origin === undefined ? {} : { origin: body.origin }),
              ...(body.whyNow === undefined ? {} : { whyNow: body.whyNow }),
              ...(body.desiredOutcome === undefined ? {} : { desiredOutcome: body.desiredOutcome }),
            },
            runtimeContext,
          ),
      });
      const result = managed.value;
      const response = {
        requestId: identity.requestId,
        userMessage: source.userMessage,
        ...result,
        synthetic: services.provider.state.synthetic,
      };
      const metadata = responseMetadata.parse(response);
      store.complete({
        owner,
        conversationId,
        requestId: identity.requestId,
        response,
        tutorMessageId: metadata.tutorMessage.id,
        run: metadata.run,
      });
      return c.json(response, 201);
    } catch (error) {
      const turnError =
        error instanceof ApiError
          ? new ApiError(error.status, error.code, error.message, {
              ...error.details,
              ...(error.code === "thread_not_open" && body.threadId !== undefined
                ? { candidateIds: JSON.stringify([body.threadId]) }
                : {}),
              ...(body.requestId === undefined ? {} : { requestId: identity.requestId }),
              ...(sourceId === undefined ? {} : { userMessageId: sourceId }),
            })
          : new ApiError(500, "tutor_turn_failed", "Tutor turn failed after saving input", {
              ...(body.requestId === undefined ? {} : { requestId: identity.requestId }),
              ...(sourceId === undefined ? {} : { userMessageId: sourceId }),
            });
      if (sourceId !== undefined)
        store.fail({
          owner,
          conversationId,
          requestId: identity.requestId,
          state:
            turnError.code === "thread_selection_ambiguous" || turnError.code === "thread_not_open"
              ? "needs_selection"
              : "failed",
          error: {
            status: turnError.status,
            code: turnError.code,
            message: turnError.message,
            ...(turnError.details === undefined ? {} : { details: turnError.details }),
          },
        });
      throw turnError;
    } finally {
      services.turnLocks.delete(lock);
    }
  });
};
