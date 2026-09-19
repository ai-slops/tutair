import type { z } from "zod";
import type { candidateSchema, evaluatedSchema, lintedSchema } from "./tutor-schemas.js";

const words = (text: string): readonly string[] =>
  text.toLocaleLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

export function copiedFromTutor(learnerText: string, tutorTexts: readonly string[]): boolean {
  const learner = new Set(words(learnerText));
  if (learner.size < 5) return false;
  return tutorTexts.some((text) => {
    const tutor = new Set(words(text));
    const overlap = [...learner].filter((word) => tutor.has(word)).length;
    return overlap / Math.min(learner.size, Math.max(tutor.size, 1)) >= 0.72;
  });
}

export function enforceCopiedDiscount(
  evaluation: z.infer<typeof evaluatedSchema>,
  copied: boolean,
): z.infer<typeof evaluatedSchema> {
  if (!copied) return evaluation;
  return {
    ...evaluation,
    evidence: evaluation.evidence.map((item) => ({ ...item, copied: true })),
  };
}

export function applyKnowledgeRisk(
  candidate: z.infer<typeof candidateSchema>,
): z.infer<typeof candidateSchema> {
  if (candidate.riskScope === "stable" || candidate.riskScope === "definition-sensitive") {
    return candidate;
  }
  return { ...candidate, confidence: Math.min(candidate.confidence, 0.49) };
}

export function unsafeRiskyFinal(
  lint: z.infer<typeof lintedSchema>,
  knowledge: readonly { readonly riskScope: string }[],
): boolean {
  return (
    !lint.safe &&
    knowledge.some(
      (item) => item.riskScope === "high-stakes" || item.riskScope === "current-contested",
    )
  );
}

export function markLintSkipped(text: string, lintSkipped: boolean): string {
  return lintSkipped ? `${text}\n\n[Safety lint unavailable; verify important claims.]` : text;
}
