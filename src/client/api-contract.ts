import { HTTPError } from "ky";
import { z } from "zod";
import { TurnOutcomeSchema } from "./learning-contract";
import type { ConversationSummary } from "./learning-model";
import type { Message, ProviderStatus } from "./model";
import { REVIEW_ACTIONS, REVIEW_STATUSES } from "./model";

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
  .catchall(z.unknown());
export const MessageSchema = z
  .object({
    id: IdSchema,
    role: z.enum(["user", "tutor"]),
    content: z.string(),
    createdAt: DateSchema,
    deletedAt: DateSchema.nullable(),
  })
  .catchall(z.unknown());
export const ConversationsSchema = z.object({ conversations: z.array(ConversationSchema) });
export const ConversationDetailSchema = z.object({
  conversation: ConversationSchema,
  messages: z.array(MessageSchema),
  threads: z.array(z.object({ id: IdSchema }).catchall(z.unknown())),
  currentThreadId: IdSchema.nullable().default(null),
  turnOutcomes: z.array(TurnOutcomeSchema).default([]),
});
export const CapabilitiesSchema = z.object({
  provider: z.string(),
  model: z.string().nullable(),
  generation: z.boolean(),
  embedding: z.boolean(),
  search: z.boolean(),
  searchMode: z.enum(["hybrid", "fts-only"]),
  synthetic: z.boolean(),
  chatgpt: z
    .object({
      enabled: z.boolean(),
      connected: z.boolean(),
      manualCallback: z.boolean().default(false),
      selectedModel: z.string().nullable().optional(),
    })
    .default({ enabled: false, connected: false, manualCallback: false }),
});
export const ChatGptModelsSchema = z.object({
  models: z.array(z.object({ slug: z.string().min(1), displayName: z.string().min(1) })),
});
export const KnowledgeRecordSchema = z
  .object({
    id: IdSchema,
    title: z.string(),
    currentRevision: z.number().int(),
    scope: z.enum(["canonical", "provisional"]),
    kind: z.string(),
    createdAt: DateSchema,
  })
  .catchall(z.unknown());
const KnowledgeReviewStatusSchema = z.object({
  status: z.enum(REVIEW_STATUSES),
  revision: z.number().int().positive(),
  revisionId: IdSchema,
  reason: z.string().nullable(),
  updatedAt: DateSchema.nullable(),
});
export const KnowledgeListSchema = z.object({
  items: z.array(KnowledgeRecordSchema.extend({ reviewStatus: KnowledgeReviewStatusSchema })),
});
export const RevisionSchema = z
  .object({
    id: IdSchema,
    revision: z.number().int(),
    statement: z.string(),
    semanticScope: z.string(),
    sourceType: z.string(),
    sourceRef: z.string().nullable(),
    createdAt: DateSchema,
  })
  .catchall(z.unknown());
export const KnowledgeReviewEventSchema = z
  .object({
    id: IdSchema,
    revision: z.number().int().positive(),
    action: z.enum(REVIEW_ACTIONS),
    reason: z.string().nullable(),
    createdAt: DateSchema,
  })
  .catchall(z.unknown());
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
  .catchall(z.unknown());
export const ExposureSchema = z
  .object({ id: IdSchema, messageId: z.string().nullable(), createdAt: DateSchema })
  .catchall(z.unknown());
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
  .catchall(z.unknown());
const KnowledgeDocumentSchema = z
  .object({
    id: IdSchema,
    role: z.enum(["english_base", "localization", "legacy"]),
    languageTag: z.string(),
    version: z.number().int().positive(),
    sourceType: z.string(),
    sourceRefs: z.array(z.string()),
    createdAt: DateSchema,
    stale: z.boolean(),
    blocks: z.array(
      z
        .object({
          id: IdSchema,
          type: z.string(),
          content: z.string(),
          contentHash: z.string(),
          sourceBlockId: IdSchema.nullable(),
        })
        .catchall(z.unknown()),
    ),
  })
  .catchall(z.unknown());
export const KnowledgeDetailSchema = z
  .object({
    item: KnowledgeRecordSchema,
    revisions: z.array(RevisionSchema),
    evidence: z.array(EvidenceRecordSchema),
    exposures: z.array(ExposureSchema),
    learnerState: z.array(LearnerStateSchema).default([]),
    reviewStatus: KnowledgeReviewStatusSchema,
    reviewHistory: z.array(KnowledgeReviewEventSchema),
    documents: z.array(KnowledgeDocumentSchema).default([]),
  })
  .catchall(z.unknown());
export const TutorTurnSchema = z
  .object({
    userMessage: MessageSchema,
    tutorMessage: MessageSchema.optional(),
    synthetic: z.boolean(),
  })
  .catchall(z.unknown());
export const SignupSchema = z.object({
  learner: z.object({ id: IdSchema }).catchall(z.unknown()),
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
  .catchall(z.unknown());
export const SearchResponseSchema = z
  .object({
    results: z.array(SearchResultSchema),
    mode: z.enum(["hybrid", "fts-only"]),
    degradedReason: z.string().optional(),
  })
  .catchall(z.unknown());

const ErrorBodySchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.record(z.string(), z.string()).default({}),
  }),
});

export class ApiError extends Error {
  readonly name = "ApiError";
  readonly details: Readonly<Record<string, string>>;
  constructor(
    readonly code: string,
    message: string,
    options?: ErrorOptions & { readonly details?: Readonly<Record<string, string>> },
  ) {
    super(message, options);
    this.details = options?.details ?? {};
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
        { cause, details: parsed.success ? parsed.data.error.details : {} },
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

export function mapConversation(record: z.infer<typeof ConversationSchema>): ConversationSummary {
  return {
    id: record.id,
    title: record.title || record.goal || "Untitled conversation",
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
  if (capabilities.provider === "chatgpt") {
    if (!capabilities.chatgpt.connected)
      return {
        mode: "unavailable",
        label: "ChatGPT not connected",
        guidance: "Connect this local learner to ChatGPT before tutoring.",
      };
    if (
      capabilities.chatgpt.selectedModel === null ||
      capabilities.chatgpt.selectedModel === undefined
    )
      return {
        mode: "unavailable",
        label: "Choose a ChatGPT model",
        guidance: "Select one of the models available to this ChatGPT account.",
      };
    return {
      mode: "configured",
      label: capabilities.chatgpt.selectedModel,
      guidance: "Tutor generation uses this learner's personal ChatGPT connection.",
    };
  }
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
