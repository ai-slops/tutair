import { applyCorrection } from "./correction-store.js";
import type { Database } from "./database.js";
import { knowledgeScopeFingerprint, migrateRevisionMetadata } from "./knowledge-contracts.js";
import type {
  CorrectionInput,
  KnowledgeReviewInput,
  NewEvidence,
  NewKnowledge,
  NewRevision,
} from "./knowledge-inputs.js";
import {
  appendReview,
  eligibleKnowledgeIds,
  reviewHistory,
  reviewStatus,
} from "./knowledge-review.js";
import { insertKnowledgeRevision } from "./knowledge-revision-store.js";
import { exactGeneratedKnowledge } from "./knowledge-semantic-reuse.js";
import { knowledgeRecord, learnerStateRecord, revisionRecord } from "./records.js";
import { insertEvidence, listEvidence, rebuildEvidenceProjections } from "./repository-evidence.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

export class KnowledgeRepository {
  constructor(readonly db: Database) {}
  list(owner: LearnerId, scope = "all"): readonly unknown[] {
    const clause =
      scope === "canonical"
        ? "learner_id IS NULL"
        : scope === "provisional"
          ? "learner_id=?"
          : "(learner_id IS NULL OR learner_id=?)";
    return this.db.all(
      `SELECT * FROM knowledge_items WHERE ${clause} ORDER BY title`,
      scope === "canonical" ? [] : [owner],
      knowledgeRecord,
    );
  }
  listWithReview(owner: LearnerId, scope = "all"): readonly unknown[] {
    return this.list(owner, scope).map((raw) => {
      const item = knowledgeRecord.parse(raw);
      const revision = revisionRecord.parse(this.revision(owner, item.id, item.current_revision));
      return {
        ...item,
        review_status: reviewStatus(this.db, owner, item.id, item.current_revision, revision.id),
      };
    });
  }
  item(owner: LearnerId, id: string) {
    const row = this.db.one(
      "SELECT * FROM knowledge_items WHERE id=? AND (learner_id IS NULL OR learner_id=?)",
      [id, owner],
      knowledgeRecord,
    );
    if (row === null) throw new ApiError(404, "knowledge_not_found", "Knowledge item not found");
    return row;
  }
  revisions(owner: LearnerId, id: string): readonly unknown[] {
    this.item(owner, id);
    return this.db.all(
      "SELECT * FROM knowledge_revisions WHERE knowledge_id=? ORDER BY revision",
      [id],
      revisionRecord,
    );
  }
  revision(owner: LearnerId, id: string, revision: number) {
    this.item(owner, id);
    const row = this.db.one(
      "SELECT * FROM knowledge_revisions WHERE knowledge_id=? AND revision=?",
      [id, revision],
      revisionRecord,
    );
    if (row === null) throw new ApiError(404, "revision_not_found", "Revision not found");
    return row;
  }
  learnerState(owner: LearnerId, id: string, revision?: number) {
    this.item(owner, id);
    return this.db.all(
      `SELECT * FROM learner_state WHERE learner_id=? AND knowledge_id=?${
        revision === undefined ? "" : " AND revision=?"
      } ORDER BY revision,dimension`,
      revision === undefined ? [owner, id] : [owner, id, revision],
      learnerStateRecord,
    );
  }
  create(
    owner: LearnerId | null,
    input: NewKnowledge,
  ): { readonly item: unknown; readonly revision: unknown } {
    if (owner === null && input.canonicalKey !== undefined) {
      const existing = this.db.one(
        "SELECT * FROM knowledge_items WHERE learner_id IS NULL AND canonical_key=?",
        [input.canonicalKey],
        knowledgeRecord,
      );
      if (existing !== null) {
        const current = this.revision(
          "00000000-0000-0000-0000-000000000000",
          existing.id,
          existing.current_revision,
        );
        const currentMetadata = migrateRevisionMetadata(revisionRecord.parse(current));
        if (
          knowledgeScopeFingerprint(
            currentMetadata.semanticScope,
            currentMetadata.definitionScope,
          ) !== knowledgeScopeFingerprint(input.semanticScope ?? "", input.definitionScope)
        )
          throw new ApiError(
            409,
            "canonical_scope_mismatch",
            "A canonical key cannot be reimported with a different definition scope",
          );
        return {
          item: existing,
          revision: this.addRevision("00000000-0000-0000-0000-000000000000", {
            knowledgeId: existing.id,
            statement: input.statement,
            sourceType: "canonical_import",
            sourceRef: input.sourceRef ?? null,
            details: input,
          }),
        };
      }
    }
    return this.db.transaction(() => {
      if (owner !== null && input.sourceType === "model_generated") {
        const existing = exactGeneratedKnowledge(this.db, owner, input);
        if (existing !== null) return existing;
      }
      const id = newId();
      const now = isoNow();
      const scope = owner === null ? "canonical" : "provisional";
      this.db.run("INSERT INTO knowledge_items VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", [
        id,
        owner,
        input.canonicalKey ?? null,
        scope,
        input.riskScope,
        input.title,
        input.kind ?? "claim",
        JSON.stringify(input.aliases ?? []),
        1,
        0,
        input.confidence,
        now,
      ]);
      const revision = insertKnowledgeRevision(this.db, {
        knowledgeId: id,
        revision: 1,
        statement: input.statement,
        sourceType: owner === null ? "canonical_import" : (input.sourceType ?? "learner_manual"),
        sourceRef: input.sourceRef ?? null,
        authority: owner === null ? "canonical" : "provisional",
        details: input,
      });
      this.db.run("INSERT INTO knowledge_fts VALUES(?,?,?)", [id, input.title, input.statement]);
      return {
        item: this.item(owner ?? "00000000-0000-0000-0000-000000000000", id),
        revision,
      };
    });
  }
  createOrReuseGenerated(
    owner: LearnerId,
    input: NewKnowledge,
  ): { readonly item: unknown; readonly revision: unknown; readonly created: boolean } {
    return this.db.transaction(() => {
      const existing = exactGeneratedKnowledge(this.db, owner, input);
      if (existing !== null) return { ...existing, created: false };
      return { ...this.create(owner, input), created: true };
    });
  }
  addRevision(owner: LearnerId, input: NewRevision): unknown {
    const item = this.item(owner, input.knowledgeId);
    if (item.learner_id === null && input.sourceType !== "canonical_import")
      throw new ApiError(
        409,
        "canonical_immutable",
        "Canonical knowledge can only be revised by canonical import",
      );
    const next = item.current_revision + 1;
    return this.db.transaction(() => {
      const revision = insertKnowledgeRevision(this.db, {
        knowledgeId: input.knowledgeId,
        revision: next,
        statement: input.statement,
        sourceType: input.sourceType,
        sourceRef: input.sourceRef,
        authority: item.learner_id === null ? "canonical" : "provisional",
        ...(input.details === undefined ? {} : { details: input.details }),
      });
      this.db.run("UPDATE knowledge_items SET current_revision=? WHERE id=?", [
        next,
        input.knowledgeId,
      ]);
      this.db.run("DELETE FROM knowledge_fts WHERE knowledge_id=?", [input.knowledgeId]);
      this.db.run("INSERT INTO knowledge_fts VALUES(?,?,?)", [
        input.knowledgeId,
        item.title,
        input.statement,
      ]);
      return revision;
    });
  }
  evidence(owner: LearnerId, knowledgeId?: string, revision?: number): readonly unknown[] {
    return listEvidence(this.db, {
      owner,
      ...(knowledgeId === undefined ? {} : { knowledgeId }),
      ...(revision === undefined ? {} : { revision }),
    });
  }
  addEvidence(owner: LearnerId, input: NewEvidence): unknown {
    return insertEvidence(this.db, owner, input);
  }
  rebuild(owner: LearnerId, knowledgeId?: string): number {
    return rebuildEvidenceProjections(this.db, owner, knowledgeId);
  }
  correct(owner: LearnerId, input: CorrectionInput) {
    return applyCorrection(this.db, this, owner, input);
  }
  review(owner: LearnerId, input: KnowledgeReviewInput) {
    const revision = revisionRecord.parse(this.revision(owner, input.knowledgeId, input.revision));
    return appendReview(this.db, owner, revision.id, input);
  }
  reviewHistory(owner: LearnerId, knowledgeId: string) {
    this.item(owner, knowledgeId);
    return reviewHistory(this.db, owner, knowledgeId);
  }
  reviewStatus(owner: LearnerId, knowledgeId: string, revision: number) {
    const found = revisionRecord.parse(this.revision(owner, knowledgeId, revision));
    return reviewStatus(this.db, owner, knowledgeId, revision, found.id);
  }
  eligibleIds(owner: LearnerId, ids: readonly string[]): readonly string[] {
    return eligibleKnowledgeIds(this.db, owner, ids);
  }
}
