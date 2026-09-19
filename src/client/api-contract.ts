import { HTTPError } from "ky";
import { z } from "zod";
import type { Message, ProviderStatus, Thread } from "./model";

const DateSchema = z.string().min(1);
export const IdSchema = z.string().min(1);
export const ConversationSchema = z
  .object({
    id: IdSchema,
    title: z.string(),
    goal: z.string().nullable(),
    createdAt: DateSchema,
    updatedAt: DateSchema,
  })
  .passthrough();
export const MessageSchema = z
  .object({
    id: IdSchema,
    role: z.enum(["user", "tutor"]),
    content: z.string(),
    createdAt: DateSchema,
    deletedAt: DateSchema.nullable(),
  })
  .passthrough();
export const ConversationsSchema = z.object({ conversations: z.array(ConversationSchema) });
export const ConversationDetailSchema = z.object({
  conversation: ConversationSchema,
  messages: z.array(MessageSchema),
  threads: z.array(z.object({ id: IdSchema }).passthrough()),
});
export const ThreadDetailSchema = z
  .object({ conversations: z.array(ConversationSchema) })
  .passthrough();
export const ThreadResumeSchema = z.object({ conversation: ConversationSchema }).passthrough();
export const CapabilitiesSchema = z.object({
  provider: z.string(),
  model: z.string().nullable(),
  generation: z.boolean(),
  embedding: z.boolean(),
  search: z.boolean(),
  searchMode: z.enum(["hybrid", "fts-only"]),
  synthetic: z.boolean(),
});
export const KnowledgeRecordSchema = z
  .object({
    id: IdSchema,
    title: z.string(),
    currentRevision: z.number().int(),
    createdAt: DateSchema,
  })
  .passthrough();
export const KnowledgeListSchema = z.object({ items: z.array(KnowledgeRecordSchema) });
export const RevisionSchema = z
  .object({
    revision: z.number().int(),
    statement: z.string(),
    sourceRef: z.string().nullable(),
    createdAt: DateSchema,
  })
  .passthrough();
export const EvidenceRecordSchema = z
  .object({
    id: IdSchema,
    dimension: z.enum([
      "recognition",
      "recall",
      "explanation",
      "application",
      "discrimination",
      "transfer",
    ]),
    polarity: z.string(),
    createdAt: DateSchema,
    messageId: z.string(),
  })
  .passthrough();
export const ExposureSchema = z
  .object({ id: IdSchema, messageId: z.string().nullable(), createdAt: DateSchema })
  .passthrough();
export const LearnerStateSchema = z
  .object({
    dimension: EvidenceRecordSchema.shape.dimension,
    estimate: z.number(),
    uncertainty: z.number(),
    status: z.enum(["unknown", "exposed", "tentative", "supported", "stale"]),
    effectiveEvidence: z.number(),
    projectionVersion: z.string(),
    knowledgeRevisionId: IdSchema,
    evidenceIds: z.array(IdSchema),
  })
  .passthrough();
export const KnowledgeDetailSchema = z
  .object({
    item: KnowledgeRecordSchema,
    revisions: z.array(RevisionSchema),
    evidence: z.array(EvidenceRecordSchema),
    exposures: z.array(ExposureSchema),
    learnerState: z.array(LearnerStateSchema).default([]),
  })
  .passthrough();
export const TutorTurnSchema = z
  .object({
    userMessage: MessageSchema,
    tutorMessage: MessageSchema.optional(),
    synthetic: z.boolean(),
  })
  .passthrough();
export const SignupSchema = z.object({
  learner: z.object({ id: IdSchema }).passthrough(),
  synthetic: z.boolean(),
});
export const SearchResultSchema = z
  .object({
    id: IdSchema,
    entityType: z.enum(["knowledge", "message", "thread", "evidence"]),
    title: z.string(),
    statement: z.string(),
    score: z.number(),
  })
  .passthrough();
export const SearchResponseSchema = z
  .object({
    results: z.array(SearchResultSchema),
    mode: z.enum(["hybrid", "fts-only"]),
    degradedReason: z.string().optional(),
  })
  .passthrough();

const ErrorBodySchema = z.object({ error: z.object({ code: z.string(), message: z.string() }) });

export class ApiError extends Error {
  readonly name = "ApiError";
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

export async function request<T>(
  operation: () => Promise<unknown>,
  schema: z.ZodType<T>,
): Promise<T> {
  try {
    return schema.parse(await operation());
  } catch (cause) {
    if (cause instanceof HTTPError) {
      const parsed = ErrorBodySchema.safeParse(await cause.response.json());
      throw new ApiError(
        parsed.success ? parsed.data.error.code : "http_error",
        parsed.success
          ? parsed.data.error.message
          : `Request failed with status ${cause.response.status}`,
        { cause },
      );
    }
    if (cause instanceof z.ZodError)
      throw new ApiError(
        "invalid_response",
        "The server returned data Tutair could not safely read.",
        { cause },
      );
    throw cause;
  }
}

export function mapThread(record: z.infer<typeof ConversationSchema>): Thread {
  return {
    id: record.id,
    title: record.title || record.goal || "Untitled learning thread",
    updatedAt: record.updatedAt,
  };
}

export function mapMessage(record: z.infer<typeof MessageSchema>): Message {
  return {
    id: record.id,
    role: record.role === "user" ? "user" : "assistant",
    content: record.deletedAt === null ? record.content : "This message was deleted.",
    createdAt: record.createdAt,
    status: "complete",
  };
}

export function providerFrom(capabilities: z.infer<typeof CapabilitiesSchema>): ProviderStatus {
  if (capabilities.synthetic)
    return {
      mode: "synthetic",
      label: "Synthetic demo provider",
      guidance:
        "The server is demonstrating the tutor pipeline without presenting scripted output as a real model.",
    };
  if (capabilities.generation)
    return {
      mode: "configured",
      label: capabilities.model ?? capabilities.provider ?? "Model connected",
      guidance: "Tutor generation is available through the server-configured provider.",
    };
  return {
    mode: "unavailable",
    label: "Model unavailable",
    guidance:
      "The server has no generation model configured. Configure it on the server; never paste a model key into this browser.",
  };
}

export function dimensionFor(
  value: string | undefined,
): "Recognition" | "Recall" | "Explanation" | "Application" | "Discrimination" | "Transfer" | null {
  switch (value?.toLocaleLowerCase()) {
    case "explanation":
      return "Explanation";
    case "application":
      return "Application";
    case "discrimination":
      return "Discrimination";
    case "transfer":
      return "Transfer";
    case "recognition":
      return "Recognition";
    case "recall":
      return "Recall";
    default:
      return null;
  }
}
