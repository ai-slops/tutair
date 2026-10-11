import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Database } from "../../src/server/database.js";
import { KnowledgeDocumentRepository } from "../../src/server/knowledge-document-repository.js";
import { createProvider, type TutorProvider } from "../../src/server/provider.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import { KnowledgeRepository } from "../../src/server/repository-knowledge.js";
import { retrievalDocuments } from "../../src/server/retrieval-documents.js";
import { searchKnowledge } from "../../src/server/search.js";

const databases: Database[] = [];
afterEach(() => {
  for (const db of databases.splice(0)) db.close();
});

function fixture() {
  const db = new Database(":memory:");
  databases.push(db);
  const core = new CoreRepository(db);
  const first = z.object({ id: z.string() }).parse(core.signup("First").learner).id;
  const other = z.object({ id: z.string() }).parse(core.signup("Other").learner).id;
  for (const owner of [first, other]) {
    const conversation = z
      .object({ id: z.string() })
      .parse(core.createConversation(owner, owner, null));
    core.createMessage(
      owner,
      conversation.id,
      "learner",
      owner === first
        ? "Finite machines move between states through a transition."
        : "Secret private photosynthesis",
    );
  }
  return { db, core, first, other };
}

describe("scoped hybrid search", () => {
  it("uses token stemming rather than substring matching", async () => {
    const { db, first } = fixture();
    const result = await searchKnowledge(
      db,
      createProvider({ TUTOR_PROVIDER: "disabled", TUTOR_EMBEDDING_PROVIDER: "disabled" }),
      first,
      "transitions",
      10,
    );
    expect(result.mode).toBe("fts-only");
    expect(result.results).toHaveLength(1);
  });

  it("never ranks another learner's messages", async () => {
    const { db, first } = fixture();
    const result = await searchKnowledge(
      db,
      createProvider({ TUTOR_PROVIDER: "disabled", TUTOR_EMBEDDING_PROVIDER: "disabled" }),
      first,
      "photosynthesis",
      10,
    );
    expect(result.results).toEqual([]);
  });

  it("returns semantic matches with no lexical overlap", async () => {
    const { db, first } = fixture();
    const provider: TutorProvider = {
      state: {
        provider: "demo",
        model: "test",
        generation: false,
        synthetic: true,
        embedding: "configured",
      },
      embeddingProfile: "test-v1",
      call: async () => ({}),
      embed: async (texts) => texts.map(() => [1, 0]),
    };
    const result = await searchKnowledge(db, provider, first, "automaton", 10);
    expect(result.mode).toBe("hybrid");
    expect(result.results).toHaveLength(1);
  });

  it("reports degraded lexical search for inconsistent vector dimensions", async () => {
    const { db, first } = fixture();
    const provider: TutorProvider = {
      state: {
        provider: "demo",
        model: "test",
        generation: false,
        synthetic: true,
        embedding: "configured",
      },
      embeddingProfile: "broken-test-v1",
      call: async () => ({}),
      embed: async (texts) => texts.map((text) => (text === "transition" ? [1, 0] : [1, 0, 0])),
    };
    const result = await searchKnowledge(db, provider, first, "transition", 10);
    expect(result.mode).toBe("fts-only");
    expect(result.degradedReason).toBe("embedding_unavailable");
  });

  it("projects one current multilingual search record without historical rank or cache duplication", async () => {
    const { db, first } = fixture();
    const knowledge = new KnowledgeRepository(db);
    const created = knowledge.create(first, {
      title: "State",
      statement: "Current definition",
      riskScope: "stable",
      confidence: 0.9,
      sourceType: "learner_manual",
    });
    const revisionId = z.object({ id: z.string() }).parse(created.revision).id;
    const documents = new KnowledgeDocumentRepository(db);
    const firstEnglish = documents.create({
      owner: first,
      knowledgeRevisionId: revisionId,
      role: "english_base",
      languageTag: "en",
      sourceType: "learner_manual",
      sourceRefs: [],
      blocks: [
        { type: "definition", content: "Current definition" },
        { type: "example", content: "obsolete-example" },
      ],
    });
    documents.create({
      owner: first,
      knowledgeRevisionId: revisionId,
      role: "english_base",
      languageTag: "en",
      supersedesDocumentId: firstEnglish.id,
      sourceType: "learner_manual",
      sourceRefs: [],
      blocks: [
        { type: "definition", content: "Current definition" },
        { type: "example", content: "active-example" },
      ],
    });

    const knowledgeId = z.object({ id: z.string() }).parse(created.item).id;
    const records = retrievalDocuments(db, first).filter((record) => record.id === knowledgeId);

    expect(records).toHaveLength(1);
    expect(records[0]?.statement).toContain("active-example");
    expect(records[0]?.statement).not.toContain("obsolete-example");

    const embeddedTexts: string[] = [];
    const provider: TutorProvider = {
      state: {
        provider: "demo",
        model: "test",
        generation: false,
        synthetic: true,
        embedding: "configured",
      },
      embeddingProfile: "stable-record-test-v1",
      call: async () => ({}),
      embed: async (texts) => {
        embeddedTexts.push(...texts);
        return texts.map(() => [1, 0]);
      },
    };
    await searchKnowledge(db, provider, first, "active example", 10);
    await searchKnowledge(db, provider, first, "active example", 10);

    expect(embeddedTexts.filter((text) => text.includes("active-example"))).toHaveLength(1);
    expect(
      db.one(
        "SELECT COUNT(*) AS count FROM embedding_cache WHERE entity_type='knowledge' AND entity_id=?",
        [knowledgeId],
        z.object({ count: z.number() }),
      )?.count,
    ).toBe(1);
  });
});
