import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import { knowledgeContext } from "../../src/server/tutor-knowledge.js";
import { persistResolution } from "../../src/server/tutor-knowledge-persistence.js";
import type { admissionArtifactSchema, resolutionSchema } from "../../src/server/tutor-schemas.js";
import { createTutorTestContext } from "./tutor-test-fixtures.js";

type Artifact = z.infer<typeof admissionArtifactSchema>;
type ClaimArtifact = Extract<Artifact, { readonly artifactType: "claim" }>;

const claim = {
  artifactType: "claim",
  key: "state-persists",
  label: "State persistence",
  proposition: "A state persists until an event causes a transition.",
  subjectDefinitionRevisionId: "11111111-1111-4111-8111-111111111111",
  predicate: "persists until",
  object: "a transition-triggering event",
  evidentialScope: "finite-state machines",
  provenanceStatus: "model_generated",
  provenanceBasis: "Generated for later review.",
  sourceRefs: [],
  riskScope: "stable",
  confidence: 0.95,
  sourceSpans: [],
} satisfies ClaimArtifact;

const match = (artifact: Artifact, knowledgeId: string) =>
  ({
    candidateKey: artifact.key,
    knowledgeId,
    revision: 1,
    confidence: 0.99,
    decision: "semantic",
    reasonCodes: ["same_kind"],
  }) satisfies z.infer<typeof resolutionSchema>["matches"][number];

describe("explicit typed reuse persistence", () => {
  const databases: Database[] = [];
  afterEach(() => databases.splice(0).forEach((database) => void database.close()));

  it("rejects a wrong persisted contract match and accepts the exact typed identity", () => {
    const context = createTutorTestContext(databases, "Reuse", "Verify typed identity");
    const createDefinition = (title: string) =>
      context.knowledge.create(context.owner, {
        title,
        statement: `${title} definition`,
        riskScope: "stable",
        confidence: 0.9,
        kind: "concept",
        sourceType: "learner_manual",
      });
    const firstDefinition = createDefinition("State");
    const secondDefinition = createDefinition("Event");
    const parsed = (created: typeof firstDefinition) => ({
      itemId: z.object({ id: z.string().uuid() }).parse(created.item).id,
      revisionId: z.object({ id: z.string().uuid() }).parse(created.revision).id,
    });
    const first = parsed(firstDefinition);
    const second = parsed(secondDefinition);
    const storedContract = { ...claim, subjectDefinitionRevisionId: first.revisionId };
    const stored = context.knowledge.createOrReuseGenerated(
      context.owner,
      {
        title: storedContract.label,
        statement: storedContract.proposition,
        riskScope: storedContract.riskScope,
        confidence: storedContract.confidence,
        kind: "claim",
        semanticScope: storedContract.evidentialScope,
        sourceType: "model_generated",
      },
      {
        artifactType: "claim",
        contractJson: JSON.stringify(storedContract),
        extractionRunId: crypto.randomUUID(),
        resolutionRunId: crypto.randomUUID(),
        modelReviewJson: "{}",
      },
    );
    const storedItemId = z.object({ id: z.string().uuid() }).parse(stored.item).id;
    const offeredKnowledge = knowledgeContext(context.knowledge, context.owner, [
      first.itemId,
      second.itemId,
      storedItemId,
    ]);
    const candidate = {
      ...storedContract,
      key: "candidate",
      subjectDefinitionRevisionId: second.revisionId,
    } satisfies ClaimArtifact;
    const insertRun = (): string => {
      const runId = crypto.randomUUID();
      context.database.run("INSERT INTO model_runs VALUES(?,?,?,?,?,?,?,?,?,?,?)", [
        runId,
        context.owner,
        context.conversationId,
        "resolution",
        "test",
        "demo",
        "completed",
        null,
        null,
        null,
        new Date().toISOString(),
      ]);
      return runId;
    };

    const rejected = persistResolution({
      repository: context.knowledge,
      owner: context.owner,
      conversationId: context.conversationId,
      messageId: crypto.randomUUID(),
      extractionRunId: crypto.randomUUID(),
      runId: insertRun(),
      candidates: [candidate],
      offeredKnowledge,
      resolution: { matches: [match(candidate, storedItemId)], admissions: [] },
    });
    const compatible = {
      ...storedContract,
      key: "compatible-candidate",
      label: "State remains active",
      confidence: 0.91,
    } satisfies ClaimArtifact;
    const accepted = persistResolution({
      repository: context.knowledge,
      owner: context.owner,
      conversationId: context.conversationId,
      messageId: crypto.randomUUID(),
      extractionRunId: crypto.randomUUID(),
      runId: insertRun(),
      candidates: [compatible],
      offeredKnowledge,
      resolution: { matches: [match(compatible, storedItemId)], admissions: [] },
    });

    expect(rejected.knowledgeIds).toEqual([]);
    expect(rejected.resolvedByKey.has(candidate.key)).toBe(false);
    expect(accepted.knowledgeIds).toEqual([storedItemId]);
    expect(accepted.resolvedByKey.get(compatible.key)?.knowledgeId).toBe(storedItemId);
  });
});
