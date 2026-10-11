import { createHash } from "node:crypto";
import { z } from "zod";
import type { Database } from "./database.js";
import { type DocumentCreate, documentCreateSchema } from "./knowledge-document-contracts.js";
import { migrateLegacyDocuments } from "./knowledge-document-migration.js";
import type { LearnerId } from "./types.js";
import { ApiError, isoNow, newId } from "./types.js";

const documentRow = z.object({
  id: z.string(),
  owner_learner_id: z.string().nullable(),
  knowledge_revision_id: z.string(),
  role: z.enum(["english_base", "localization", "legacy"]),
  language_tag: z.string(),
  version: z.number().int(),
  base_document_id: z.string().nullable(),
  supersedes_document_id: z.string().nullable(),
  source_type: z.string(),
  model_run_id: z.string().nullable(),
  source_refs_json: z.string(),
  created_at: z.string(),
});
const blockRow = z.object({
  id: z.string(),
  document_id: z.string(),
  position: z.number().int(),
  block_type: z.string(),
  content: z.string(),
  content_hash: z.string(),
  source_block_id: z.string().nullable(),
});
const idRow = z.object({ id: z.string() });

export class KnowledgeDocumentRepository {
  constructor(private readonly db: Database) {}

  migrateLegacy(): void {
    migrateLegacyDocuments(this.db.raw);
  }

  transaction<T>(work: () => T): T {
    return this.db.transaction(work);
  }

  create(raw: DocumentCreate) {
    const input = documentCreateSchema.parse(raw);
    this.assertRevision(input);
    const base = input.baseDocumentId === undefined ? null : this.document(input.baseDocumentId);
    this.assertBase(input, base);
    this.assertSupersedes(input);
    const version = this.nextVersion(input);
    const id = newId();
    this.db.transaction(() => {
      this.db.run("INSERT INTO knowledge_documents VALUES(?,?,?,?,?,?,?,?,?,?,?,?)", [
        id,
        input.owner,
        input.knowledgeRevisionId,
        input.role,
        input.languageTag,
        version,
        input.baseDocumentId ?? null,
        input.supersedesDocumentId ?? null,
        input.sourceType,
        input.modelRunId ?? null,
        JSON.stringify(input.sourceRefs),
        isoNow(),
      ]);
      input.blocks.forEach((block, position) => {
        this.assertSourceBlock(input, base, block.sourceBlockId);
        const blockId = newId();
        this.db.run("INSERT INTO knowledge_document_blocks VALUES(?,?,?,?,?,?,?)", [
          blockId,
          id,
          position,
          block.type,
          block.content,
          createHash("sha256").update(block.content).digest("hex"),
          block.sourceBlockId ?? null,
        ]);
        const topics = block.topicRevisionIds ?? [input.knowledgeRevisionId];
        for (const topic of new Set(topics)) {
          this.assertTopic(input, topic);
          this.db.run("INSERT INTO knowledge_document_block_topics VALUES(?,?)", [blockId, topic]);
        }
      });
    });
    return this.get(input.owner, id);
  }

  get(owner: LearnerId | null, id: string) {
    const row = this.document(id);
    if (row.owner_learner_id !== null && row.owner_learner_id !== owner)
      throw new ApiError(404, "document_not_found", "Knowledge document not found");
    return this.present(row);
  }

  forRevision(owner: LearnerId | null, revisionId: string) {
    return this.db
      .all(
        `SELECT d.* FROM knowledge_documents d
         JOIN knowledge_revisions r ON r.id=d.knowledge_revision_id
         JOIN knowledge_items k ON k.id=r.knowledge_id
         WHERE d.knowledge_revision_id=?
           AND (d.owner_learner_id=? OR (d.owner_learner_id IS NULL AND k.learner_id IS NULL))
         ORDER BY d.role,d.language_tag,d.version`,
        [revisionId, owner],
        documentRow,
      )
      .map((row) => this.present(row));
  }

  private present(row: z.infer<typeof documentRow>) {
    const blocks = this.db.all(
      "SELECT * FROM knowledge_document_blocks WHERE document_id=? ORDER BY position",
      [row.id],
      blockRow,
    );
    const baseOwner =
      row.base_document_id === null
        ? row.owner_learner_id
        : this.document(row.base_document_id).owner_learner_id;
    const newestEnglish = this.db.one(
      `SELECT id FROM knowledge_documents WHERE knowledge_revision_id=? AND role='english_base'
       AND owner_learner_id IS ? ORDER BY version DESC LIMIT 1`,
      [row.knowledge_revision_id, baseOwner],
      idRow,
    );
    return {
      id: row.id,
      owner: row.owner_learner_id,
      knowledgeRevisionId: row.knowledge_revision_id,
      role: row.role,
      languageTag: row.language_tag,
      version: row.version,
      baseDocumentId: row.base_document_id,
      supersedesDocumentId: row.supersedes_document_id,
      sourceType: row.source_type,
      modelRunId: row.model_run_id,
      sourceRefs: z.array(z.string()).parse(JSON.parse(row.source_refs_json)),
      createdAt: row.created_at,
      stale: row.role === "localization" && row.base_document_id !== newestEnglish?.id,
      blocks: blocks.map((block) => ({
        id: block.id,
        position: block.position,
        type: block.block_type,
        content: block.content,
        contentHash: block.content_hash,
        sourceBlockId: block.source_block_id,
        topicRevisionIds: this.db
          .all(
            "SELECT knowledge_revision_id AS id FROM knowledge_document_block_topics WHERE block_id=? ORDER BY knowledge_revision_id",
            [block.id],
            idRow,
          )
          .map((topic) => topic.id),
      })),
    };
  }

  private document(id: string): z.infer<typeof documentRow> {
    const row = this.db.one("SELECT * FROM knowledge_documents WHERE id=?", [id], documentRow);
    if (row === null)
      throw new ApiError(422, "invalid_document_link", "Linked document does not exist");
    return row;
  }

  private assertRevision(input: DocumentCreate): void {
    const row = this.db.one(
      `SELECT r.id,k.learner_id FROM knowledge_revisions r JOIN knowledge_items k ON k.id=r.knowledge_id WHERE r.id=?`,
      [input.knowledgeRevisionId],
      z.object({ id: z.string(), learner_id: z.string().nullable() }),
    );
    if (row === null || (row.learner_id !== null && row.learner_id !== input.owner))
      throw new ApiError(
        422,
        "invalid_document_owner",
        "Document owner cannot access this revision",
      );
    if (row.learner_id === null && input.sourceType === "model_generated" && input.owner === null)
      throw new ApiError(
        422,
        "shared_generated_document",
        "Generated canonical expressions must be learner-private",
      );
  }

  private assertBase(input: DocumentCreate, base: z.infer<typeof documentRow> | null): void {
    if (base === null) return;
    if (
      base.role !== "english_base" ||
      base.language_tag !== "en" ||
      base.knowledge_revision_id !== input.knowledgeRevisionId ||
      !(
        base.owner_learner_id === input.owner ||
        (base.owner_learner_id === null && this.sharedRevision(input.knowledgeRevisionId))
      )
    )
      throw new ApiError(
        422,
        "invalid_localization_base",
        "Localization base must be matching English document",
      );
  }

  private assertSupersedes(input: DocumentCreate): void {
    if (input.supersedesDocumentId === undefined) return;
    const prior = this.document(input.supersedesDocumentId);
    if (
      prior.owner_learner_id !== input.owner ||
      prior.knowledge_revision_id !== input.knowledgeRevisionId ||
      prior.role !== input.role ||
      prior.language_tag !== input.languageTag
    )
      throw new ApiError(
        422,
        "invalid_document_predecessor",
        "Superseded document must have the same identity",
      );
  }

  private assertSourceBlock(
    input: DocumentCreate,
    base: z.infer<typeof documentRow> | null,
    sourceBlockId?: string,
  ): void {
    if (input.role !== "localization") return;
    const source =
      sourceBlockId === undefined
        ? null
        : this.db.one(
            "SELECT id,block_type FROM knowledge_document_blocks WHERE id=? AND document_id=?",
            [sourceBlockId, base?.id ?? ""],
            z.object({ id: z.string(), block_type: z.string() }),
          );
    if (source === null)
      throw new ApiError(
        422,
        "invalid_source_block",
        "Localized block must link to its exact source block",
      );
    const localized = input.blocks.find((block) => block.sourceBlockId === sourceBlockId);
    if (localized === undefined || source.block_type !== localized.type)
      throw new ApiError(
        422,
        "localized_block_type_mismatch",
        "Localized block type must match its English source block",
      );
    const sourceTopics = this.db
      .all(
        "SELECT knowledge_revision_id AS id FROM knowledge_document_block_topics WHERE block_id=? ORDER BY knowledge_revision_id",
        [source.id],
        idRow,
      )
      .map((topic) => topic.id);
    const localizedTopics = [...(localized.topicRevisionIds ?? [input.knowledgeRevisionId])].sort();
    if (JSON.stringify(sourceTopics) !== JSON.stringify(localizedTopics))
      throw new ApiError(
        422,
        "localized_block_topic_mismatch",
        "Localized block topics must match its English source block",
      );
  }

  private assertTopic(input: DocumentCreate, topic: string): void {
    const row = this.db.one(
      `SELECT r.id,k.learner_id FROM knowledge_revisions r JOIN knowledge_items k ON k.id=r.knowledge_id WHERE r.id=?`,
      [topic],
      z.object({ id: z.string(), learner_id: z.string().nullable() }),
    );
    if (row === null || (row.learner_id !== null && row.learner_id !== input.owner))
      throw new ApiError(
        422,
        "invalid_block_topic",
        "Block topic is not an accessible knowledge revision",
      );
  }

  private nextVersion(input: DocumentCreate): number {
    const row = this.db.one(
      `SELECT COALESCE(MAX(version),0) AS version FROM knowledge_documents
       WHERE owner_learner_id IS ? AND knowledge_revision_id=? AND role=? AND language_tag=?`,
      [input.owner, input.knowledgeRevisionId, input.role, input.languageTag],
      z.object({ version: z.number() }),
    );
    return (row?.version ?? 0) + 1;
  }

  private sharedRevision(revisionId: string): boolean {
    return (
      this.db.one(
        `SELECT r.id FROM knowledge_revisions r JOIN knowledge_items k ON k.id=r.knowledge_id
         WHERE r.id=? AND k.learner_id IS NULL`,
        [revisionId],
        idRow,
      ) !== null
    );
  }
}
