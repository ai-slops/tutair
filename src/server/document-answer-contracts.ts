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
    const blocks = value.materials.reduce(
      (count, material) => count + material.englishBlocks.length + material.localizedBlocks.length,
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
    if (blocks > 24) context.addIssue({ code: "custom", message: "Preparation exceeds 24 blocks" });
    if (text > 20_000)
      context.addIssue({ code: "custom", message: "Preparation exceeds 20000 characters" });
  });

export const preparationSchemaFor = (reusableEnglishDefinitionIds: ReadonlySet<string>) =>
  preparationSchema.superRefine((value, context) => {
    value.materials.forEach((material, materialIndex) => {
      if (material.englishBlocks.length === 0) return;
      const definitionCount = material.englishBlocks.filter(
        (block) => block.type === "definition",
      ).length;
      const required = !reusableEnglishDefinitionIds.has(material.knowledgeRevisionId);
      if (definitionCount > 1 || (required && definitionCount !== 1))
        context.addIssue({
          code: "custom",
          path: ["materials", materialIndex, "englishBlocks"],
          message: required
            ? "New English material requires exactly one English definition"
            : "English material permits at most one generated definition",
        });
    });
  });
