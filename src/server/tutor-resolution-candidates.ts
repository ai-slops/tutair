import { z } from "zod";
import type { KnowledgeContext } from "./tutor-knowledge.js";
import type { candidateSchema, extractionSchema } from "./tutor-schemas.js";

export function extractionCandidates(
  extraction: z.infer<typeof extractionSchema>,
): readonly z.infer<typeof candidateSchema>[] {
  return [
    ...extraction.targets,
    ...extraction.prerequisites,
    ...extraction.terms,
    ...extraction.distinctions,
    ...extraction.misconceptions,
    ...extraction.claims,
  ];
}

export function resolutionProbeQueries(
  candidates: readonly z.infer<typeof candidateSchema>[],
): readonly string[] {
  return [
    ...new Set(
      candidates.map((candidate) =>
        [candidate.label, candidate.definition, candidate.semanticScope]
          .filter((part) => part.trim() !== "")
          .join("\n")
          .slice(0, 500),
      ),
    ),
  ]
    .filter((query) => query !== "")
    .slice(0, 4);
}

export function orderedResolutionCandidates(
  knowledge: readonly KnowledgeContext[],
  retrieved: readonly unknown[],
  labels: readonly string[],
): readonly KnowledgeContext[] {
  const normalized = new Set(labels.map((label) => label.toLocaleLowerCase()));
  const retrievedIds = new Set(
    retrieved.flatMap((raw) => {
      const parsed = z.object({ id: z.string() }).safeParse(raw);
      return parsed.success ? [parsed.data.id] : [];
    }),
  );
  const rank = (item: KnowledgeContext): number =>
    item.scope === "canonical" &&
    [item.title, ...item.aliases].some((label) => normalized.has(label.toLocaleLowerCase()))
      ? 0
      : item.scope === "canonical" && retrievedIds.has(item.id)
        ? 1
        : item.scope === "canonical"
          ? 2
          : 3;
  return knowledge.toSorted(
    (left, right) => rank(left) - rank(right) || left.title.localeCompare(right.title),
  );
}
