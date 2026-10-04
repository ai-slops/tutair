import { z } from "zod";
import { evaluatedSchema } from "./evaluation-schema.js";
import type { KnowledgeContext } from "./tutor-knowledge.js";
import type { TurnInput } from "./tutor-schemas.js";

export function evaluationSchemaFor(
  offered: readonly KnowledgeContext[],
  input: TurnInput,
  assessments: readonly unknown[],
) {
  const assessmentIds = new Set(
    z
      .array(z.object({ id: z.string() }))
      .parse(assessments)
      .map((row) => row.id),
  );
  const unitIds = new Set(offered.map((unit) => unit.id));
  return evaluatedSchema.superRefine((value, context) => {
    for (const [index, observation] of value.evidence.entries()) {
      const unit = offered.find((item) => item.id === observation.knowledgeId);
      const valid =
        unit?.revisionId === observation.knowledgeRevisionId &&
        unit.revision === observation.revision &&
        observation.relatedKnowledgeIds.every((id) => unitIds.has(id)) &&
        (observation.threadId === null || observation.threadId === input.threadId) &&
        (observation.assessmentId === null || assessmentIds.has(observation.assessmentId)) &&
        observation.sourceSpans.every(
          (span) => span.start < span.end && span.end <= input.content.length,
        );
      if (!valid)
        context.addIssue({
          code: "custom",
          path: ["evidence", index],
          message:
            "Observation must use offered revisions, thread, assessments and valid source spans",
        });
    }
  });
}
