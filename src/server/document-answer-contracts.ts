import { z } from "zod";
import { blockTypes } from "./knowledge-document-contracts.js";

const preparedBlock = z
  .object({ type: z.enum(blockTypes), content: z.string().min(1).max(20_000) })
  .strict();
export const preparationSchema = z
  .object({
    materials: z
      .array(
        z
          .object({
            knowledgeRevisionId: z.string().uuid(),
            englishBlocks: z.array(preparedBlock).max(24),
            localizedBlocks: z
              .array(
                preparedBlock
                  .extend({ sourceEnglishIndex: z.number().int().nonnegative() })
                  .strict(),
              )
              .max(24),
          })
          .strict(),
      )
      .max(24),
  })
  .strict()
  .superRefine((value, context) => {
    const englishBlocks = value.materials.reduce(
      (count, material) => count + material.englishBlocks.length,
      0,
    );
    const localizedBlocks = value.materials.reduce(
      (count, material) => count + material.localizedBlocks.length,
      0,
    );
    const text = value.materials.reduce(
      (count, material) =>
        count +
        [...material.englishBlocks, ...material.localizedBlocks].reduce(
          (sum, block) => sum + block.content.length,
          0,
        ),
      0,
    );
    if (englishBlocks > 24)
      context.addIssue({ code: "custom", message: "Preparation exceeds 24 English blocks" });
    if (localizedBlocks > 24)
      context.addIssue({ code: "custom", message: "Preparation exceeds 24 localized blocks" });
    if (text > 20_000)
      context.addIssue({ code: "custom", message: "Preparation exceeds 20000 characters" });
  });

export const preparationSchemaFor = (
  reusableEnglishPrimaryIds: ReadonlySet<string>,
  primaryBlockByRevision: ReadonlyMap<string, "definition" | "claim" | "contrast"> = new Map(),
) =>
  preparationSchema.superRefine((value, context) => {
    value.materials.forEach((material, materialIndex) => {
      if (material.englishBlocks.length === 0) return;
      const primaryType = primaryBlockByRevision.get(material.knowledgeRevisionId) ?? "definition";
      const primaryCount = material.englishBlocks.filter(
        (block) => block.type === primaryType,
      ).length;
      const required = !reusableEnglishPrimaryIds.has(material.knowledgeRevisionId);
      if (primaryCount > 1 || (required && primaryCount !== 1))
        context.addIssue({
          code: "custom",
          path: ["materials", materialIndex, "englishBlocks"],
          message: required
            ? `New English material requires exactly one ${primaryType} block`
            : `English material permits at most one generated ${primaryType} block`,
        });
    });
  });
