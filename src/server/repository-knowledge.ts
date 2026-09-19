import { applyCorrection } from "./correction-store.js";
import type { Database } from "./database.js";
import type {
  CorrectionInput,
  NewEvidence,
  NewKnowledge,
  NewRevision,
} from "./knowledge-inputs.js";
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
        const semanticScope = revisionRecord.parse(current).semantic_scope;
        if (semanticScope !== (input.semanticScope ?? ""))
          throw new ApiError(
            409,
            "canonical_scope_mismatch",
            "A canonical key cannot be reimported with a different semantic scope",
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
    const id = newId();
    const revisionId = newId();
    const now = isoNow();
    const scope = owner === null ? "canonical" : "provisional";
    this.db.transaction(() => {
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
      this.db.run("INSERT INTO knowledge_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        revisionId,
        id,
        1,
        input.statement,
        input.semanticScope ?? "",
        JSON.stringify(input.distinguishingFeatures ?? []),
        JSON.stringify(
          (input.claims ?? []).map((claim) =>
            typeof claim === "string"
              ? {
                  text: claim,
                  authority: owner === null ? "canonical" : "provisional",
                  sourceRefs: input.sourceRefs ?? [],
                }
              : claim,
          ),
        ),
        JSON.stringify(
          input.sourceRefs ?? (input.sourceRef === undefined ? [] : [input.sourceRef]),
        ),
        owner === null ? "canonical_import" : (input.sourceType ?? "learner_manual"),
        input.sourceRef ?? null,
        input.modelRunId ?? null,
        input.conversationId ?? null,
        JSON.stringify(input.sourceMessageIds ?? []),
        JSON.stringify(input.sourceMessageEventIds ?? []),
        now,
      ]);
      this.db.run("INSERT INTO knowledge_fts VALUES(?,?,?)", [id, input.title, input.statement]);
    });
    return {
      item: this.item(owner ?? "00000000-0000-0000-0000-000000000000", id),
      revision: this.db.one(
        "SELECT * FROM knowledge_revisions WHERE id=?",
        [revisionId],
        revisionRecord,
      ),
    };
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
    const now = isoNow();
    const revisionId = newId();
    this.db.transaction(() => {
      this.db.run("INSERT INTO knowledge_revisions VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)", [
        revisionId,
        input.knowledgeId,
        next,
        input.statement,
        input.details?.semanticScope ?? "",
        JSON.stringify(input.details?.distinguishingFeatures ?? []),
        JSON.stringify(
          (input.details?.claims ?? []).map((claim) =>
            typeof claim === "string"
              ? {
                  text: claim,
                  authority: item.learner_id === null ? "canonical" : "provisional",
                  sourceRefs: input.details?.sourceRefs ?? [],
                }
              : claim,
          ),
        ),
        JSON.stringify(
          input.details?.sourceRefs ?? (input.sourceRef === null ? [] : [input.sourceRef]),
        ),
        input.sourceType,
        input.sourceRef,
        input.details?.modelRunId ?? null,
        input.details?.conversationId ?? null,
        JSON.stringify(input.details?.sourceMessageIds ?? []),
        JSON.stringify(input.details?.sourceMessageEventIds ?? []),
        now,
      ]);
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
    });
    return this.db.one(
      "SELECT * FROM knowledge_revisions WHERE id=?",
      [revisionId],
      revisionRecord,
    );
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
}
