import { z } from "zod";
import type { Database } from "./database.js";
import type { LearnerId } from "./types.js";
import { ApiError } from "./types.js";

const requestRow = z.object({
  user_message_id: z.string(),
  tutor_message_id: z.string().nullable(),
});
const runRow = z.object({
  id: z.string(),
  stage: z.string(),
  status: z.enum(["running", "completed", "failed"]),
  context_json: z.string().nullable(),
  reasoning_summary_enabled: z.number().int().nullable(),
  summary_text: z.string().nullable(),
});
const documentRow = z.object({
  knowledge_id: z.string(),
  revision_id: z.string(),
  revision: z.number().int().positive(),
  title: z.string(),
  scope: z.enum(["canonical", "provisional"]),
});
const snapshotDocument = z.object({
  id: z.string(),
  revisionId: z.string(),
  revision: z.number().int().positive(),
});
const preparedDocumentRow = z.object({
  id: z.string(),
  knowledge_id: z.string(),
  knowledge_revision_id: z.string(),
  role: z.enum(["english_base", "localization", "legacy"]),
  language_tag: z.string(),
});

type TurnKey = {
  readonly owner: LearnerId;
  readonly conversationId: string;
  readonly requestId: string;
};

export class AnswerProvenanceStore {
  constructor(private readonly db: Database) {}

  get(key: TurnKey): unknown {
    const request = this.db.one(
      `SELECT user_message_id,tutor_message_id FROM tutor_turn_requests
       WHERE learner_id=? AND conversation_id=? AND request_id=?`,
      [key.owner, key.conversationId, key.requestId],
      requestRow,
    );
    if (request === null)
      throw new ApiError(404, "answer_provenance_not_found", "Answer provenance not found");
    const runs = this.db.all(
      `SELECT r.id,r.stage,r.status,c.context_json,i.reasoning_summary_enabled,s.summary_text
       FROM model_runs r
       LEFT JOIN model_run_contexts c ON c.run_id=r.id
       LEFT JOIN model_run_inspection i ON i.run_id=r.id
       LEFT JOIN model_run_reasoning_summaries s ON s.run_id=r.id
       WHERE r.learner_id=? AND r.conversation_id=? AND r.input_message_id=?
       ORDER BY r.created_at,r.id`,
      [key.owner, key.conversationId, request.user_message_id],
      runRow,
    );
    const provided = new Map<string, { readonly id: string; readonly stages: Set<string> }>();
    for (const run of runs) {
      const context = parseJson(run.context_json);
      if (context === null || typeof context !== "object" || !("data" in context)) continue;
      const data = context.data;
      if (data === null || typeof data !== "object" || !("knowledge" in data)) continue;
      const parsed = z.array(snapshotDocument).safeParse(data.knowledge);
      if (!parsed.success) continue;
      for (const document of parsed.data) {
        const existing = provided.get(document.revisionId);
        if (existing === undefined)
          provided.set(document.revisionId, {
            id: document.revisionId,
            stages: new Set([run.stage]),
          });
        else existing.stages.add(run.stage);
      }
    }
    const providedRows = this.documents(key.owner, [...provided.keys()]);
    const createdRows = this.db.all(
      `${documentSelect()} WHERE k.learner_id=? AND r.model_run_id IN (
         SELECT id FROM model_runs WHERE learner_id=? AND conversation_id=? AND input_message_id=?
       ) ORDER BY r.created_at,r.id`,
      [key.owner, key.owner, key.conversationId, request.user_message_id],
      documentRow,
    );
    const exposedRows =
      request.tutor_message_id === null
        ? []
        : this.db.all(
            `${documentSelect()} JOIN exposures e ON e.knowledge_revision_id=r.id
             WHERE e.learner_id=? AND e.message_id=? ORDER BY e.created_at,e.id`,
            [key.owner, request.tutor_message_id],
            documentRow,
          );
    const createdDocuments = this.db.all(
      `SELECT d.id,r.knowledge_id,d.knowledge_revision_id,d.role,d.language_tag
       FROM knowledge_documents d
       JOIN knowledge_revisions r ON r.id=d.knowledge_revision_id
       JOIN model_runs mr ON mr.id=d.model_run_id
       WHERE d.owner_learner_id=? AND mr.learner_id=? AND mr.conversation_id=?
         AND mr.input_message_id=? ORDER BY d.created_at,d.id`,
      [key.owner, key.owner, key.conversationId, request.user_message_id],
      preparedDocumentRow,
    );
    return {
      availability: runs.some((run) => run.context_json !== null) ? "available" : "unavailable",
      ...(runs.length === 0
        ? { reason: "No model-run record exists for this historical answer." }
        : runs.every((run) => run.context_json === null)
          ? { reason: "Exact provider-call snapshots are unavailable for this historical answer." }
          : {}),
      providedToModel: providedRows.map((row) => ({
        ...presentDocument(row),
        stages: [...(provided.get(row.revision_id)?.stages ?? [])],
      })),
      created: createdRows.map(presentDocument),
      createdDocuments: createdDocuments.map((document) => ({
        documentId: document.id,
        knowledgeId: document.knowledge_id,
        knowledgeRevisionId: document.knowledge_revision_id,
        role: document.role,
        languageTag: document.language_tag,
      })),
      exposedInAnswer: exposedRows.map(presentDocument),
      exposureCoverage: "non_exhaustive",
      reasoningSummaries: runs.map((run) => ({
        runId: run.id,
        stage: run.stage,
        ...(run.reasoning_summary_enabled !== 1
          ? { state: "disabled" }
          : run.summary_text !== null
            ? { state: "available", text: run.summary_text }
            : run.status === "running"
              ? { state: "pending" }
              : { state: "unavailable" }),
      })),
    };
  }

  private documents(
    owner: LearnerId,
    revisionIds: readonly string[],
  ): readonly z.infer<typeof documentRow>[] {
    if (revisionIds.length === 0) return [];
    return this.db.all(
      `${documentSelect()} WHERE r.id IN (${revisionIds.map(() => "?").join(",")})
       AND (k.learner_id IS NULL OR k.learner_id=?) ORDER BY k.title,r.revision`,
      [...revisionIds, owner],
      documentRow,
    );
  }
}

function documentSelect(): string {
  return `SELECT k.id AS knowledge_id,r.id AS revision_id,r.revision,k.title,k.scope
    FROM knowledge_revisions r JOIN knowledge_items k ON k.id=r.knowledge_id`;
}

function presentDocument(row: z.infer<typeof documentRow>) {
  return {
    knowledgeId: row.knowledge_id,
    revisionId: row.revision_id,
    revision: row.revision,
    title: row.title,
    scope: row.scope,
    href: `/?view=knowledge&knowledge=${row.knowledge_id}&revision=${row.revision}`,
  };
}

function parseJson(value: string | null): unknown {
  if (value === null) return null;
  try {
    return JSON.parse(value);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}
