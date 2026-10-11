import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Database } from "../../src/server/database.js";
import { KnowledgeDocumentRepository } from "../../src/server/knowledge-document-repository.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import { KnowledgeRepository } from "../../src/server/repository-knowledge.js";

const databases: Database[] = [];
afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

function fixture() {
  const database = new Database(":memory:");
  databases.push(database);
  const core = new CoreRepository(database);
  const knowledge = new KnowledgeRepository(database);
  const learner = z.object({ learner: z.object({ id: z.string() }) }).parse(core.signup("Ada"));
  const created = knowledge.create(learner.learner.id, {
    title: "상태 기계",
    statement: "유한한 상태와 전이 규칙을 가진 모델입니다.",
    riskScope: "stable",
    confidence: 0.8,
    sourceType: "learner_manual",
    semanticScope: "formal systems",
  });
  const revision = z.object({ id: z.string() }).parse(created.revision);
  return {
    database,
    owner: learner.learner.id,
    revisionId: revision.id,
    documents: new KnowledgeDocumentRepository(database),
  };
}

describe("knowledge documents", () => {
  it("migrates legacy statements byte-for-byte once without claiming English", () => {
    const { database, owner, revisionId, documents } = fixture();
    const before = database.one(
      "SELECT statement FROM knowledge_revisions WHERE id=?",
      [revisionId],
      z.object({ statement: z.string() }),
    );

    documents.migrateLegacy();
    documents.migrateLegacy();

    const detail = documents.forRevision(owner, revisionId);
    expect(detail).toHaveLength(1);
    expect(detail[0]?.role).toBe("legacy");
    expect(detail[0]?.languageTag).toBe("und");
    expect(detail[0]?.blocks[0]?.content).toBe(before?.statement);
    expect(
      database.one(
        "SELECT statement FROM knowledge_revisions WHERE id=?",
        [revisionId],
        z.object({ statement: z.string() }),
      ),
    ).toEqual(before);
  });

  it("links a localization to an exact English source and reports staleness", () => {
    const { owner, revisionId, documents } = fixture();
    const english = documents.create({
      owner,
      knowledgeRevisionId: revisionId,
      role: "english_base",
      languageTag: "en",
      sourceType: "learner_manual",
      sourceRefs: [],
      blocks: [{ type: "definition", content: "A finite set of states and transition rules." }],
    });
    const korean = documents.create({
      owner,
      knowledgeRevisionId: revisionId,
      role: "localization",
      languageTag: "ko-KR",
      baseDocumentId: english.id,
      sourceType: "model_generated",
      sourceRefs: [],
      blocks: [
        {
          type: "definition",
          content: "유한한 상태와 전이 규칙의 집합입니다.",
          sourceBlockId: english.blocks[0]?.id,
        },
      ],
    });
    documents.create({
      owner,
      knowledgeRevisionId: revisionId,
      role: "english_base",
      languageTag: "en",
      sourceType: "learner_manual",
      supersedesDocumentId: english.id,
      sourceRefs: [],
      blocks: [{ type: "definition", content: "A newer English explanation." }],
    });

    expect(documents.get(owner, korean.id).stale).toBe(true);
  });

  it("rejects invalid owner, language, base, source block, and topic relationships", () => {
    const { owner, revisionId, documents } = fixture();
    const english = documents.create({
      owner,
      knowledgeRevisionId: revisionId,
      role: "english_base",
      languageTag: "en",
      sourceType: "learner_manual",
      sourceRefs: [],
      blocks: [{ type: "definition", content: "English source." }],
    });
    const invalid = (overrides: Record<string, unknown>) =>
      documents.create({
        owner,
        knowledgeRevisionId: revisionId,
        role: "localization",
        languageTag: "ko",
        baseDocumentId: english.id,
        sourceType: "model_generated",
        sourceRefs: [],
        blocks: [
          {
            type: "definition",
            content: "번역",
            sourceBlockId: english.blocks[0]?.id,
          },
        ],
        ...overrides,
      });

    expect(() => invalid({ owner: "00000000-0000-0000-0000-000000000000" })).toThrow();
    expect(() => invalid({ languageTag: "not_a_language" })).toThrow();
    expect(() => invalid({ baseDocumentId: "00000000-0000-0000-0000-000000000000" })).toThrow();
    expect(() =>
      invalid({ blocks: [{ type: "definition", content: "번역", sourceBlockId: revisionId }] }),
    ).toThrow();
    expect(() =>
      invalid({
        blocks: [{ type: "contrast", content: "대조", topicRevisionIds: [revisionId, english.id] }],
      }),
    ).toThrow();
  });

  it("returns only shared and viewer-owned documents for a shared canonical revision", () => {
    const database = new Database(":memory:");
    databases.push(database);
    const core = new CoreRepository(database);
    const first = z.object({ id: z.string() }).parse(core.signup("First").learner).id;
    const second = z.object({ id: z.string() }).parse(core.signup("Second").learner).id;
    const knowledge = new KnowledgeRepository(database);
    const created = knowledge.create(null, {
      title: "Finite-state machine",
      statement: "A model with finite states and transition rules.",
      riskScope: "stable",
      confidence: 1,
      canonicalKey: "fsm",
      sourceRef: "test-canonical",
    });
    const revisionId = z.object({ id: z.string() }).parse(created.revision).id;
    const documents = new KnowledgeDocumentRepository(database);
    const shared = documents.create({
      owner: null,
      knowledgeRevisionId: revisionId,
      role: "english_base",
      languageTag: "en",
      sourceType: "canonical_import",
      sourceRefs: ["test-canonical"],
      blocks: [{ type: "definition", content: "A model with finite states and transition rules." }],
    });
    const privateSupplement = documents.create({
      owner: first,
      knowledgeRevisionId: revisionId,
      role: "english_base",
      languageTag: "en",
      sourceType: "model_generated",
      sourceRefs: [],
      blocks: [
        { type: "definition", content: "A model with finite states and transition rules." },
        { type: "example", content: "A door controller has locked and unlocked states." },
      ],
    });

    expect(documents.forRevision(first, revisionId).map((document) => document.id)).toEqual(
      expect.arrayContaining([shared.id, privateSupplement.id]),
    );
    expect(documents.forRevision(second, revisionId).map((document) => document.id)).toEqual([
      shared.id,
    ]);
    expect(() => documents.get(second, privateSupplement.id)).toThrow(/not found/i);
  });

  it("requires exactly one definition in every English document version", () => {
    const { owner, revisionId, documents } = fixture();
    const create = (
      blocks: { readonly type: "definition" | "example"; readonly content: string }[],
    ) =>
      documents.create({
        owner,
        knowledgeRevisionId: revisionId,
        role: "english_base",
        languageTag: "en",
        sourceType: "learner_manual",
        sourceRefs: [],
        blocks,
      });

    expect(() => create([{ type: "example", content: "A door controller." }])).toThrow(
      /exactly one definition/i,
    );
    expect(() =>
      create([
        { type: "definition", content: "First definition." },
        { type: "definition", content: "Second definition." },
      ]),
    ).toThrow(/exactly one definition/i);
  });
});
