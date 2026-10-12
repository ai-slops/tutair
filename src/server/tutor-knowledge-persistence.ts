import { z } from "zod";
import { verifiedExplicitReuseRevision } from "./explicit-reuse-verification.js";
import { knowledgeArtifactData } from "./knowledge-artifact-persistence.js";
import type { KnowledgeRepository } from "./repository-knowledge.js";
import { MisconceptionRepository } from "./repository-misconceptions.js";
import { normalizeResolution, semanticReuseConfidence } from "./resolution-policy.js";
import type { KnowledgeContext } from "./tutor-knowledge.js";
import { applyKnowledgeRisk } from "./tutor-policies.js";
import type { admissionArtifactSchema, resolutionSchema } from "./tutor-schemas.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

type Artifact = z.infer<typeof admissionArtifactSchema>;
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
      case "reuse": {
        const revisionId = verifiedExplicitReuseRevision({
          repository: input.repository,
          owner: input.owner,
          artifact,
          knowledge: decision.knowledge,
          offeredKnowledge: input.offeredKnowledge,
        });
        if (revisionId === null) {
          traces.push({
            key: artifact.key,
            resolution: "skip",
            reasons: [...decision.reasons, "typed_reuse_reverification_failed"],
          });
          continue;
        }
        ids.add(decision.knowledge.id);
        resolvedByKey.set(artifact.key, {
          knowledgeId: decision.knowledge.id,
          revisionId,
        });
        traces.push({
          key: artifact.key,
          resolution: decision.resolution,
          knowledgeId: decision.knowledge.id,
          revisionId,
          reasons: decision.reasons,
        });
        continue;
      }
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
    const data = knowledgeArtifactData(artifact);
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
