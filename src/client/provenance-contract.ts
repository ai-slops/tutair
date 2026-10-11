import { z } from "zod";

const DocumentRevisionSchema = z.object({
  knowledgeId: z.string(),
  revisionId: z.string(),
  revision: z.number().int().positive(),
  title: z.string(),
  scope: z.enum(["canonical", "provisional"]),
  href: z.string(),
  stages: z.array(z.string()).default([]),
});
export const AnswerProvenanceSchema = z.object({
  availability: z.enum(["available", "unavailable"]),
  reason: z.string().nullable().default(null),
  providedToModel: z.array(DocumentRevisionSchema),
  created: z.array(DocumentRevisionSchema),
  createdDocuments: z.array(
    z.object({
      documentId: z.string(),
      knowledgeId: z.string(),
      knowledgeRevisionId: z.string(),
      role: z.enum(["english_base", "localization", "legacy"]),
      languageTag: z.string(),
    }),
  ),
  exposedInAnswer: z.array(DocumentRevisionSchema),
  exposureCoverage: z.literal("non_exhaustive"),
  reasoningSummaries: z.array(
    z.discriminatedUnion("state", [
      z.object({ runId: z.string(), stage: z.string(), state: z.literal("disabled") }),
      z.object({ runId: z.string(), stage: z.string(), state: z.literal("pending") }),
      z.object({ runId: z.string(), stage: z.string(), state: z.literal("unavailable") }),
      z.object({
        runId: z.string(),
        stage: z.string(),
        state: z.literal("available"),
        text: z.string(),
      }),
    ]),
  ),
});
export const DebugSettingsSchema = z.object({ saveProviderReasoningSummaries: z.boolean() });

export type AnswerProvenanceRecord = z.infer<typeof AnswerProvenanceSchema>;
export type DebugSettings = z.infer<typeof DebugSettingsSchema>;
