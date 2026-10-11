import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Database } from "../../src/server/database.js";
import { DocumentPreparationService } from "../../src/server/document-preparation.js";
import { KnowledgeDocumentRepository } from "../../src/server/knowledge-document-repository.js";
import { ModelRunner } from "../../src/server/model-runner.js";
import type { StructuredCall, TutorProvider } from "../../src/server/provider.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import { KnowledgeRepository } from "../../src/server/repository-knowledge.js";
import { knowledgeContext } from "../../src/server/tutor-knowledge.js";
import { TutorStageRunner } from "../../src/server/tutor-stage.js";

const databases: Database[] = [];
afterEach(() => databases.splice(0).forEach((database) => void database.close()));

function fixture(output: (call: StructuredCall) => unknown) {
  const database = new Database(":memory:");
  databases.push(database);
  const core = new CoreRepository(database);
  const owner = z.object({ id: z.string() }).parse(core.signup("Ada").learner).id;
  const conversation = z
    .object({ id: z.string() })
    .parse(core.createConversation(owner, "Preparation", null));
  const message = z
    .object({ id: z.string() })
    .parse(core.createMessage(owner, conversation.id, "learner", "Give me an example"));
  const knowledge = new KnowledgeRepository(database);
  const created = knowledge.create(owner, {
    title: "State",
    statement: "A state captures information relevant to future behavior.",
    riskScope: "stable",
    confidence: 0.9,
    sourceType: "learner_manual",
  });
  const itemId = z.object({ id: z.string() }).parse(created.item).id;
  const revisionId = z.object({ id: z.string() }).parse(created.revision).id;
  const documents = new KnowledgeDocumentRepository(database);
  documents.create({
    owner,
    knowledgeRevisionId: revisionId,
    role: "english_base",
    languageTag: "en",
    sourceType: "learner_manual",
    sourceRefs: [],
    blocks: [
      { type: "definition", content: "A state captures information relevant to future behavior." },
    ],
  });
  const provider: TutorProvider = {
    state: {
      provider: "demo",
      model: "preparation-test",
      generation: true,
      synthetic: true,
      embedding: "disabled",
    },
    embeddingProfile: "disabled:v1",
    call: async (call) => ({ value: output(call), usage: null }),
  };
  const stages = new TutorStageRunner(new ModelRunner(database, provider), {
    owner,
    conversationId: conversation.id,
    messageId: message.id,
    content: "Give me an example",
    assistance: "none",
    selfReport: "neutral",
  });
  return {
    documents,
    owner,
    revisionId,
    service: new DocumentPreparationService(documents, stages),
    knowledge: knowledgeContext(knowledge, owner, [itemId]),
  };
}

describe("document preparation material plans", () => {
  it("adds a requested example as a new document version with the same definition", async () => {
    const definition = "A state captures information relevant to future behavior.";
    const context = fixture(() => ({
      materials: [
        {
          knowledgeRevisionId: context.revisionId,
          englishBlocks: [
            { type: "definition", content: definition },
            { type: "example", content: "Locked is a door-controller state." },
          ],
          localizedBlocks: [],
        },
      ],
    }));

    const prepared = await context.service.prepare(
      context.knowledge,
      "en",
      [{ knowledgeRevisionId: context.revisionId, blockTypes: ["definition", "example"] }],
      {},
    );

    expect(prepared.blocks.map((block) => block.type)).toEqual(["definition", "example"]);
    expect(context.documents.forRevision(context.owner, context.revisionId)).toHaveLength(2);
  });

  it("rejects an automatic definition change without publishing a partial version", async () => {
    const context = fixture(() => ({
      materials: [
        {
          knowledgeRevisionId: context.revisionId,
          englishBlocks: [
            { type: "definition", content: "A changed semantic definition." },
            { type: "example", content: "Locked is a door-controller state." },
          ],
          localizedBlocks: [],
        },
      ],
    }));

    await expect(
      context.service.prepare(
        context.knowledge,
        "en",
        [{ knowledgeRevisionId: context.revisionId, blockTypes: ["definition", "example"] }],
        {},
      ),
    ).rejects.toMatchObject({ code: "automatic_definition_change" });
    expect(context.documents.forRevision(context.owner, context.revisionId)).toHaveLength(1);
  });
});
