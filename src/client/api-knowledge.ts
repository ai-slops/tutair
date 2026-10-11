import type { KyInstance } from "ky";
import { dimensionFor, KnowledgeDetailSchema, KnowledgeListSchema, request } from "./api-contract";
import { DIMENSION_LABELS, type Evidence, type KnowledgeItem } from "./model";

export async function loadKnowledge(client: KyInstance): Promise<readonly KnowledgeItem[]> {
  const list = await request(
    () => client.get("knowledge", { searchParams: { scope: "all" } }).json(),
    KnowledgeListSchema,
  );
  return Promise.all(
    list.items.map(async (record) => {
      const detail = await request(
        () => client.get(`knowledge/${record.id}`).json(),
        KnowledgeDetailSchema,
      );
      const revision =
        detail.revisions.find((candidate) => candidate.revision === record.currentRevision) ??
        detail.revisions.at(-1);
      const evidence: readonly Evidence[] = [
        ...detail.evidence.map((item) => ({
          id: item.id,
          dimension: dimensionFor(item.dimension),
          summary:
            item.polarity === "negative"
              ? "Learner evidence needs review"
              : "Learner evidence recorded",
          source: `Learner message ${item.messageId}`,
          createdAt: item.createdAt,
        })),
        ...detail.exposures.map((item, index) => ({
          id: item.id || `${record.id}-exposure-${index}`,
          dimension: null,
          summary: "Tutor exposure recorded — not mastery evidence",
          source: "Tutor explanation exposure",
          createdAt: item.createdAt,
        })),
      ];
      return {
        id: record.id,
        name: record.title,
        definition: revision?.statement ?? "No definition is available for this revision.",
        revision: record.currentRevision,
        scope: record.scope,
        kind: record.kind,
        semanticScope: revision?.semanticScope ?? "",
        sources: revision?.sourceRef == null ? [] : [revision.sourceRef],
        evidence,
        learnerState: detail.learnerState.map((state) => ({
          dimension: DIMENSION_LABELS[state.dimension],
          estimate: state.estimate,
          uncertainty: state.uncertainty,
          status: state.status,
          effectiveEvidence: state.effectiveEvidence,
          projectionVersion: state.projectionVersion,
          knowledgeRevisionId: state.knowledgeRevisionId,
          evidenceIds: state.evidenceIds,
        })),
        reviewStatus: detail.reviewStatus,
        revisions: detail.revisions.map((item) => ({
          id: item.id,
          revision: item.revision,
          statement: item.statement,
          semanticScope: item.semanticScope,
          sourceType: item.sourceType,
          sourceRef: item.sourceRef,
          createdAt: item.createdAt,
        })),
        reviewHistory: detail.reviewHistory,
      };
    }),
  );
}
