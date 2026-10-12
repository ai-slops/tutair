import { z } from "zod";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import { MisconceptionRepository } from "./repository-misconceptions.js";
import { normalizeResolution, semanticReuseConfidence } from "./resolution-policy.js";
import type { KnowledgeContext } from "./tutor-knowledge.js";
import { applyKnowledgeRisk } from "./tutor-policies.js";
import type { admissionArtifactSchema, resolutionSchema } from "./tutor-schemas.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

type Artifact = z.infer<typeof admissionArtifactSchema>;
type KnowledgeArtifact = Extract<
  Artifact,
  { readonly artifactType: "definition" | "claim" | "distinction" }
>;

export function persistResolution(input: {
  readonly repository: KnowledgeRepository;
  readonly owner: LearnerId;
  readonly conversationId: string;
  readonly messageId: string;
  readonly extractionRunId: string;
  readonly runId: string;
  readonly resolution: z.infer<typeof resolutionSchema>;
  readonly candidates: readonly Artifact[];
  readonly offeredKnowledge: readonly KnowledgeContext[];
}): {
  readonly changes: readonly unknown[];
  readonly knowledgeIds: readonly string[];
  readonly resolvedByKey: ReadonlyMap<
    string,
    { readonly knowledgeId: string; readonly revisionId: string }
  >;
} {
  const normalized = normalizeResolution({
    artifacts: input.candidates,
    offeredKnowledge: input.offeredKnowledge,
    resolution: input.resolution,
  });
  const ids = new Set<string>();
  const resolvedByKey = new Map<
    string,
    { readonly knowledgeId: string; readonly revisionId: string }
  >();
  const changes: unknown[] = [];
  const traces: Record<string, unknown>[] = [];
  for (const decision of normalized.decisions) {
    const artifact = decision.artifact;
    switch (decision.resolution) {
      case "reuse":
      case "attach": {
        const revision = z
          .object({ id: z.string().uuid() })
          .parse(
            input.repository.revision(
              input.owner,
              decision.knowledge.id,
              decision.knowledge.revision,
            ),
          );
        ids.add(decision.knowledge.id);
        resolvedByKey.set(artifact.key, {
          knowledgeId: decision.knowledge.id,
          revisionId: revision.id,
        });
        traces.push({
          key: artifact.key,
          resolution: decision.resolution,
          knowledgeId: decision.knowledge.id,
          revisionId: revision.id,
          reasons: decision.reasons,
        });
        continue;
      }
      case "new_misconception": {
        if (artifact.artifactType !== "misconception" || decision.admission === undefined) continue;
        const misconception = new MisconceptionRepository(input.repository.db).createOrReuse(
          input.owner,
          {
            label: artifact.label,
            mistakenProposition: artifact.mistakenProposition,
            correction: artifact.correction,
            failureTask: artifact.failureTask,
            likelyError: artifact.likelyError,
            discriminatingExample: artifact.discriminatingExample,
            reuseValueReason: artifact.reuseValueReason,
            definitionRevisionLinks: artifact.definitionRevisionLinks,
            sourceRefs: [`model-run:${input.extractionRunId}`],
            sourceType: "model_generated",
            extractionRunId: input.extractionRunId,
            resolutionRunId: input.runId,
            modelReview: {
              rubricVersion: "typed-admission-v1",
              checks: decision.admission.checks,
              reasons: decision.admission.reasons,
            },
          },
        );
        changes.push(misconception);
        traces.push({
          key: artifact.key,
          resolution: "new_misconception",
          misconceptionId: misconception.id,
          reasons: decision.reasons,
        });
        continue;
      }
      case "skip":
        traces.push({ key: artifact.key, resolution: "skip", reasons: decision.reasons });
        continue;
      case "new_knowledge":
        break;
    }
    if (
      artifact.artifactType === "material" ||
      artifact.artifactType === "misconception" ||
      decision.admission === undefined
    )
      throw new ApiError(
        500,
        "invalid_knowledge_artifact",
        "Non-knowledge artifact reached knowledge persistence",
      );
    const data = knowledgeArtifact(artifact);
    const candidate = applyKnowledgeRisk(data);
    const modelReviewJson = JSON.stringify({
      rubricVersion: "typed-admission-v1",
      checks: decision.admission.checks,
      reasons: decision.admission.reasons,
    });
    const created = input.repository.createOrReuseGenerated(
      input.owner,
      {
        title: candidate.label.slice(0, 200),
        statement: candidate.statement,
        riskScope: candidate.riskScope,
        confidence: candidate.confidence,
        kind: candidate.kind,
        aliases: candidate.aliases,
        semanticScope: candidate.semanticScope,
        ...("definitionScope" in candidate && candidate.definitionScope !== undefined
          ? { definitionScope: candidate.definitionScope }
          : {}),
        distinguishingFeatures: candidate.distinguishingFeatures,
        claims: candidate.claims,
        sourceType: "model_generated",
        sourceRef: input.runId,
        modelRunId: input.runId,
        conversationId: input.conversationId,
        sourceMessageIds: [input.messageId],
      },
      {
        artifactType: artifact.artifactType,
        contractJson: JSON.stringify(artifact),
        extractionRunId: input.extractionRunId,
        resolutionRunId: input.runId,
        modelReviewJson,
      },
    );
    const parsed = z
      .object({
        item: z.object({ id: z.string().uuid() }),
        revision: z.object({ id: z.string().uuid() }),
        created: z.boolean(),
      })
      .parse(created);
    ids.add(parsed.item.id);
    resolvedByKey.set(artifact.key, {
      knowledgeId: parsed.item.id,
      revisionId: parsed.revision.id,
    });
    if (parsed.created) changes.push(created);
    traces.push({
      key: artifact.key,
      resolution: parsed.created ? "new" : "exact_fingerprint_reuse",
      knowledgeId: parsed.item.id,
      revisionId: parsed.revision.id,
      reasons: decision.reasons,
    });
  }
  input.repository.db.run("INSERT INTO traces VALUES(?,?,?,?,?,?)", [
    newId(),
    input.owner,
    input.runId,
    "knowledge_resolution_applied",
    JSON.stringify({
      decisions: traces,
      ignoredKeys: normalized.ignoredKeys,
      semanticReuseConfidence,
      reviewLabel: "resolution-stage model review",
    }),
    isoNow(),
  ]);
  return { changes, knowledgeIds: [...ids], resolvedByKey };
}

function knowledgeArtifact(artifact: KnowledgeArtifact) {
  switch (artifact.artifactType) {
    case "definition":
      return {
        ...artifact,
        kind: artifact.definitionKind,
        statement: artifact.definition,
        claims: [] as readonly string[],
      };
    case "claim":
      return {
        ...artifact,
        kind: "claim" as const,
        statement: artifact.proposition,
        aliases: [] as readonly string[],
        semanticScope: artifact.evidentialScope,
        distinguishingFeatures: [artifact.predicate, artifact.object],
        claims: [
          {
            text: artifact.proposition,
            authority: "provisional" as const,
            sourceRefs: artifact.sourceRefs,
            status: artifact.provenanceStatus,
          },
        ],
      };
    case "distinction":
      return {
        ...artifact,
        kind: "distinction" as const,
        statement: artifact.contrast,
        aliases: [] as readonly string[],
        semanticScope: artifact.criterion,
        distinguishingFeatures: [artifact.criterion],
        claims: [artifact.contrast],
      };
  }
}
