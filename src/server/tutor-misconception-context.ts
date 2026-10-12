import type { MisconceptionRepository } from "./repository-misconceptions.js";
import type { LearnerId } from "./types.js";

export function misconceptionRiskContext(
  repository: MisconceptionRepository,
  owner: LearnerId,
  offeredDefinitionRevisionIds: readonly string[],
) {
  const offered = new Set(offeredDefinitionRevisionIds);
  return repository
    .eligible(owner)
    .filter((item) =>
      item.definitionRevisionLinks.some((link) => offered.has(link.definitionRevisionId)),
    )
    .slice(0, 12)
    .map((item) => ({
      misconceptionId: item.id,
      misconceptionRevisionId: item.revisionId,
      label: item.label,
      mistakenProposition: item.mistakenProposition,
      correction: item.correction,
      failureTask: item.failureTask,
      likelyError: item.likelyError,
      definitionRevisionLinks: item.definitionRevisionLinks,
      interpretation: "potential_general_learning_risk" as const,
    }));
}
