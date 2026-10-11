import { z } from "zod";
import type { Database } from "./database.js";
import type { DocumentCreate } from "./knowledge-document-contracts.js";
import { ApiError } from "./types.js";

type DocumentIdentity = {
  readonly id: string;
  readonly owner_learner_id: string | null;
  readonly knowledge_revision_id: string;
  readonly role: "english_base" | "localization" | "legacy";
  readonly language_tag: string;
};

const idRow = z.object({ id: z.string() });
const ownerRow = z.object({ id: z.string(), learner_id: z.string().nullable() });
const documentIdentityRow = z.object({
  id: z.string(),
  owner_learner_id: z.string().nullable(),
  knowledge_revision_id: z.string(),
  role: z.enum(["english_base", "localization", "legacy"]),
  language_tag: z.string(),
});

export class KnowledgeDocumentValidator {
  constructor(private readonly db: Database) {}

  assertRevision(input: DocumentCreate): void {
    const row = this.revision(input.knowledgeRevisionId);
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

  assertBase(input: DocumentCreate, base: DocumentIdentity | null): void {
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

  assertSupersedes(input: DocumentCreate): void {
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

  assertSourceBlock(input: DocumentCreate, baseId: string | null, sourceBlockId?: string): void {
    if (input.role !== "localization") return;
    const source =
      sourceBlockId === undefined
        ? null
        : this.db.one(
            "SELECT id,block_type FROM knowledge_document_blocks WHERE id=? AND document_id=?",
            [sourceBlockId, baseId ?? ""],
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

  assertTopic(input: DocumentCreate, topic: string): void {
    const row = this.revision(topic);
    if (row === null || (row.learner_id !== null && row.learner_id !== input.owner))
      throw new ApiError(
        422,
        "invalid_block_topic",
        "Block topic is not an accessible knowledge revision",
      );
  }

  private revision(id: string) {
    return this.db.one(
      `SELECT r.id,k.learner_id FROM knowledge_revisions r
       JOIN knowledge_items k ON k.id=r.knowledge_id WHERE r.id=?`,
      [id],
      ownerRow,
    );
  }

  private document(id: string): DocumentIdentity {
    const row = this.db.one(
      "SELECT * FROM knowledge_documents WHERE id=?",
      [id],
      documentIdentityRow,
    );
    if (row === null)
      throw new ApiError(422, "invalid_document_link", "Linked document does not exist");
    return row;
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
