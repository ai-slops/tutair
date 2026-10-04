import type { Database } from "./database.js";
import { normalizeRevisionClaims } from "./knowledge-contracts.js";
import type { NewKnowledge } from "./knowledge-inputs.js";
import { revisionRecord } from "./records.js";
import { ApiError, isoNow, newId } from "./types.js";

export type RevisionWrite = {
  readonly knowledgeId: string;
  readonly revision: number;
  readonly statement: string;
  readonly sourceType: string;
  readonly sourceRef: string | null;
  readonly authority: "canonical" | "provisional";
  readonly details?: NewKnowledge;
};

export const insertKnowledgeRevision = (db: Database, write: RevisionWrite) => {
  const id = newId();
  const details = write.details;
  const sourceRefs = details?.sourceRefs ?? (write.sourceRef === null ? [] : [write.sourceRef]);
  const claims = normalizeRevisionClaims(details?.claims ?? [], write.sourceType).map((claim) =>
    typeof claim === "string" && write.sourceType !== "model_generated"
      ? claim
      : typeof claim === "string"
        ? {
            text: claim,
            authority: write.authority,
            sourceRefs,
            status: "model_generated" as const,
          }
        : {
            ...claim,
            authority: claim.authority ?? write.authority,
            sourceRefs: claim.sourceRefs.length === 0 ? sourceRefs : claim.sourceRefs,
          },
  );
  db.run(
    "INSERT INTO knowledge_revisions(id,knowledge_id,revision,statement,semantic_scope,definition_scope_json,distinguishing_features_json,claims_json,source_refs_json,source_type,source_ref,model_run_id,conversation_id,source_message_ids_json,source_message_event_ids_json,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    [
      id,
      write.knowledgeId,
      write.revision,
      write.statement,
      details?.semanticScope ?? "",
      JSON.stringify(details?.definitionScope ?? {}),
      JSON.stringify(details?.distinguishingFeatures ?? []),
      JSON.stringify(claims),
      JSON.stringify(sourceRefs),
      write.sourceType,
      write.sourceRef,
      details?.modelRunId ?? null,
      details?.conversationId ?? null,
      JSON.stringify(details?.sourceMessageIds ?? []),
      JSON.stringify(details?.sourceMessageEventIds ?? []),
      isoNow(),
    ],
  );
  const revision = db.one("SELECT * FROM knowledge_revisions WHERE id=?", [id], revisionRecord);
  if (revision === null)
    throw new ApiError(500, "revision_persistence_failed", "Knowledge revision was not persisted");
  return revision;
};
