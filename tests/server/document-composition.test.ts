import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { AnswerCompositionStore, renderSelection } from "../../src/server/answer-composition.js";
import { Database } from "../../src/server/database.js";
import { KnowledgeDocumentRepository } from "../../src/server/knowledge-document-repository.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import { KnowledgeRepository } from "../../src/server/repository-knowledge.js";

const databases: Database[] = [];
afterEach(() => databases.splice(0).forEach((database) => void database.close()));

function fixture() {
  const database = new Database(":memory:");
  databases.push(database);
  const core = new CoreRepository(database);
  const learner = z.object({ learner: z.object({ id: z.string() }) }).parse(core.signup("Ada"));
  const conversation = z
    .object({ id: z.string() })
    .parse(core.createConversation(learner.learner.id, "Composition", null));
  const knowledge = new KnowledgeRepository(database);
  const created = knowledge.create(learner.learner.id, {
    title: "State",
    statement: "A state captures relevant future behavior.",
    riskScope: "stable",
    confidence: 0.8,
    sourceType: "model_generated",
  });
  const revisionId = z.object({ id: z.string() }).parse(created.revision).id;
  const document = new KnowledgeDocumentRepository(database).create({
    owner: learner.learner.id,
    knowledgeRevisionId: revisionId,
    role: "english_base",
    languageTag: "en",
    sourceType: "model_generated",
    sourceRefs: [],
    blocks: [
      { type: "definition", content: "A state captures relevant future behavior." },
      { type: "example", content: "A locked door is one state." },
    ],
  });
  return { database, core, owner: learner.learner.id, conversationId: conversation.id, document };
}

describe("document answer composition", () => {
  it("rejects final free prose and unknown blocks", () => {
    const { document } = fixture();
    expect(() => renderSelection({ text: "invented" }, document.blocks)).toThrow();
    expect(() =>
      renderSelection(
        { segments: [{ blockId: "00000000-0000-0000-0000-000000000000", layout: "paragraph" }] },
        document.blocks,
      ),
    ).toThrow();
  });

  it("reconstructs a persisted answer byte-for-byte and detects source mutation", () => {
    const { database, core, owner, conversationId, document } = fixture();
    const rendered = renderSelection(
      {
        segments: [
          { blockId: document.blocks[0]?.id ?? "", layout: "paragraph" },
          { blockId: document.blocks[1]?.id ?? "", layout: "bullet" },
        ],
      },
      document.blocks,
    );
    const message = z
      .object({ id: z.string() })
      .parse(core.createMessage(owner, conversationId, "tutor", rendered.text));
    const store = new AnswerCompositionStore(database);
    store.save({ owner, messageId: message.id, runId: null, rendered });

    expect(store.reconstruct(owner, message.id).text).toBe(rendered.text);
    database.raw.exec("DROP TRIGGER immutable_knowledge_document_blocks_update");
    database.run("UPDATE knowledge_document_blocks SET content='mutated' WHERE id=?", [
      document.blocks[0]?.id ?? "",
    ]);
    expect(() => store.reconstruct(owner, message.id)).toThrow(/hash|reconstruct/i);
  });
});
