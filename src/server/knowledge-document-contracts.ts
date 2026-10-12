import { z } from "zod";

export const documentRoles = ["english_base", "localization", "legacy"] as const;
export const blockTypes = [
  "definition",
  "scope",
  "feature",
  "claim",
  "example",
  "contrast",
  "prerequisite",
  "caveat",
  "procedure_step",
] as const;

export const languageTagSchema = z
  .string()
  .regex(/^(?:und|[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-[A-Z]{2}|-[0-9]{3})?)$/);
const blockInput = z.object({
  type: z.enum(blockTypes),
  content: z.string().min(1).max(20_000),
  sourceBlockId: z.string().uuid().optional(),
  topicRevisionIds: z.array(z.string().uuid()).max(24).optional(),
});
const documentCreateObject = z.object({
  owner: z.string().uuid().nullable(),
  knowledgeRevisionId: z.string().uuid(),
  role: z.enum(documentRoles),
  languageTag: languageTagSchema,
  baseDocumentId: z.string().uuid().optional(),
  supersedesDocumentId: z.string().uuid().optional(),
  sourceType: z.enum(["canonical_import", "learner_manual", "model_generated"]),
  modelRunId: z.string().uuid().optional(),
  sourceRefs: z.array(z.string().min(1).max(2_000)).max(32),
  blocks: z.array(blockInput).min(1).max(24),
});
const validateDocumentLinks = (
  value: Pick<
    z.infer<typeof documentCreateObject>,
    "role" | "languageTag" | "baseDocumentId" | "blocks"
  >,
  context: z.RefinementCtx,
): void => {
  if (value.role === "english_base" && value.languageTag !== "en")
    context.addIssue({
      code: "custom",
      path: ["languageTag"],
      message: "English base must use en",
    });
  if (value.role === "legacy" && value.languageTag !== "und")
    context.addIssue({
      code: "custom",
      path: ["languageTag"],
      message: "Legacy material must use und",
    });
  if (value.role === "localization" && value.baseDocumentId === undefined)
    context.addIssue({
      code: "custom",
      path: ["baseDocumentId"],
      message: "Localization needs an English base",
    });
  if (value.role !== "localization" && value.baseDocumentId !== undefined)
    context.addIssue({
      code: "custom",
      path: ["baseDocumentId"],
      message: "Only localizations use a base document",
    });
  if (
    value.role === "english_base" &&
    value.blocks.filter((block) => ["definition", "claim", "contrast"].includes(block.type))
      .length !== 1
  )
    context.addIssue({
      code: "custom",
      path: ["blocks"],
      message:
        "English base documents require exactly one definition, claim, or contrast primary content block",
    });
  if (value.role === "localization") {
    const sourceIds = value.blocks.flatMap((block) =>
      block.sourceBlockId === undefined ? [] : [block.sourceBlockId],
    );
    if (sourceIds.length !== value.blocks.length || new Set(sourceIds).size !== sourceIds.length)
      context.addIssue({
        code: "custom",
        path: ["blocks"],
        message: "Localized blocks require unique exact source block IDs",
      });
  }
};
export const documentCreateSchema = documentCreateObject.superRefine(validateDocumentLinks);
export const documentCreateBodySchema = documentCreateObject
  .omit({ owner: true, knowledgeRevisionId: true })
  .superRefine(validateDocumentLinks);
export type DocumentCreate = z.infer<typeof documentCreateSchema>;
