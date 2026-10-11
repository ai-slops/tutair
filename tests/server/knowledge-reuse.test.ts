import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { Database } from "../../src/server/database.js";
import type { NewKnowledge } from "../../src/server/knowledge-inputs.js";
import { TutorPipeline } from "../../src/server/tutor.js";
import { loadTutorContext } from "../../src/server/tutor-context.js";
import {
  createTutorTestContext,
  learnerMessage,
  providerFor,
  type TutorTestContext,
} from "./tutor-test-fixtures.js";

const createdKnowledge = z.object({
  item: z.object({ id: z.string(), current_revision: z.number() }),
  revision: z.object({ id: z.string(), revision: z.number() }),
});

const modelKnowledge = {
  title: "상태 기계",
  statement: "A model with finite states and explicit transition rules.",
  riskScope: "stable",
  confidence: 0.9,
  kind: "concept",
  aliases: ["finite-state machine", "FSM"],
  semanticScope: "computer science",
  definitionScope: {
    domain: "formal systems",
    inclusions: ["finite states", "transitions"],
    exclusions: ["ceremonial usage"],
  },
  sourceType: "model_generated",
} as const satisfies NewKnowledge;

const createModelKnowledge = (context: TutorTestContext, overrides: Partial<NewKnowledge> = {}) =>
  createdKnowledge.parse(
    context.knowledge.create(context.owner, { ...modelKnowledge, ...overrides }),
  );

describe("provisional knowledge reuse", () => {
  const databases: Database[] = [];
  afterEach(() => {
    for (const database of databases.splice(0)) database.close();
  });

  it("keeps unit IDs stable when repeated turns return the same provisional candidates", async () => {
    // Given
    const context = createTutorTestContext(databases, "FSM", "Understand state machines");
    const pipeline = new TutorPipeline(
      context.database,
      context.core,
      context.knowledge,
      providerFor(),
    );

    // When
    const firstContent = "Explain an FSM simply";
    await pipeline.turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId: learnerMessage(context, firstContent),
      content: firstContent,
      assistance: "none",
      selfReport: "neutral",
    });
    const firstIds = context.knowledge
      .list(context.owner, "provisional")
      .map((raw) => z.object({ id: z.string() }).parse(raw).id)
      .toSorted();
    const secondContent = "Could you explain that again?";
    await pipeline.turn({
      owner: context.owner,
      conversationId: context.conversationId,
      messageId: learnerMessage(context, secondContent),
      content: secondContent,
      assistance: "none",
      selfReport: "neutral",
    });
    const secondIds = context.knowledge
      .list(context.owner, "provisional")
      .map((raw) => z.object({ id: z.string() }).parse(raw).id)
      .toSorted();

    // Then
    expect(firstIds.length).toBeGreaterThan(0);
    expect(secondIds).toEqual(firstIds);
  });

  it("reuses exact semantics before insert whether the current revision is unreviewed or reviewed", () => {
    // Given
    const context = createTutorTestContext(databases, "Reuse", "Reuse exact knowledge");
    const first = createModelKnowledge(context);

    // When
    const unreviewed = createModelKnowledge(context, {
      title: "FINITE-STATE MACHINE",
      statement: "  a model with finite states and explicit transition rules.  ",
      aliases: ["상태 기계"],
    });
    context.knowledge.review(context.owner, {
      knowledgeId: first.item.id,
      revision: 1,
      action: "reviewed",
      reason: null,
      confirmed: false,
    });
    const reviewed = createModelKnowledge(context);

    // Then
    expect(unreviewed.item.id).toBe(first.item.id);
    expect(reviewed.item.id).toBe(first.item.id);
  });

  it("does not merge title-only matches, distinct scopes, different owners, or retired units", () => {
    // Given
    const context = createTutorTestContext(databases, "Isolation", "Keep meanings separate");
    const first = createModelKnowledge(context);
    const otherOwner = z
      .object({ learner: z.object({ id: z.string() }) })
      .parse(context.core.signup("Grace")).learner.id;

    // When
    const titleOnly = createModelKnowledge(context, { statement: "A ceremonial arrangement." });
    const otherScope = createModelKnowledge(context, {
      semanticScope: "social etiquette",
      definitionScope: { domain: "social customs", inclusions: ["ceremony"] },
    });
    const otherOwnerUnit = createdKnowledge.parse(
      context.knowledge.create(otherOwner, modelKnowledge),
    );
    context.knowledge.review(context.owner, {
      knowledgeId: first.item.id,
      revision: 1,
      action: "retire",
      reason: "No longer applicable.",
      confirmed: false,
    });
    const afterRetirement = createModelKnowledge(context);

    // Then
    expect(new Set([first.item.id, titleOnly.item.id, otherScope.item.id])).toHaveLength(3);
    expect(otherOwnerUnit.item.id).not.toBe(first.item.id);
    expect(afterRetirement.item.id).not.toBe(first.item.id);
    expect(context.knowledge.eligibleIds(context.owner, [first.item.id])).toEqual([]);
  });

  it("returns a corrected current revision when its exact semantics recur", () => {
    // Given
    const context = createTutorTestContext(databases, "Correction", "Use corrected knowledge");
    const first = createModelKnowledge(context);
    context.knowledge.review(context.owner, {
      knowledgeId: first.item.id,
      revision: 1,
      action: "reviewed",
      reason: null,
      confirmed: false,
    });
    const correctedStatement = "A finite model whose events select explicit state transitions.";
    context.knowledge.correct(context.owner, {
      knowledgeId: first.item.id,
      revision: 1,
      statement: correctedStatement,
      reason: "Use the more precise definition.",
      kind: "revise",
      evidenceIds: [],
      targetType: "knowledge",
    });

    // When
    const recurring = createModelKnowledge(context, { statement: correctedStatement });

    // Then
    expect(recurring.item.id).toBe(first.item.id);
    expect(recurring.revision.revision).toBe(2);
    expect(context.knowledge.reviewStatus(context.owner, first.item.id, 2).status).toBe(
      "unreviewed",
    );
  });

  it("offers prior generated conversation knowledge when a generic query misses retrieval", () => {
    // Given
    const context = createTutorTestContext(databases, "Context", "Keep prior generated units");
    const prior = createModelKnowledge(context, { conversationId: context.conversationId });
    const content = "Could you go over that again?";
    const messageId = learnerMessage(context, content);
    const retrieved = Array.from({ length: 16 }, (_, index) => ({
      id: crypto.randomUUID(),
      entity_type: "message",
      title: `Distractor ${index}`,
      statement: "Unrelated context",
      scope: "private",
      revision: 0,
    }));

    // When
    const loaded = loadTutorContext(
      context.database,
      context.core,
      {
        owner: context.owner,
        conversationId: context.conversationId,
        messageId,
        content,
        assistance: "none",
        selfReport: "neutral",
      },
      retrieved,
    );

    // Then
    expect(loaded.selectedKnowledgeIds).toContain(prior.item.id);
  });

  it("offers generated units from the active thread without leaking an unrelated thread", () => {
    // Given
    const context = createTutorTestContext(databases, "Current", "Continue the active thread");
    const priorConversation = z
      .object({ id: z.string() })
      .parse(context.core.createConversation(context.owner, "Prior", "Same learning thread"));
    const activeThread = context.core.createThread(context.owner, {
      title: "Shared thread",
      goal: "Understand finite-state machines",
      conversationId: priorConversation.id,
    });
    context.core.selectThread(
      context.owner,
      context.conversationId,
      activeThread.id,
      "explicit_selection",
    );
    const linked = createModelKnowledge(context, { conversationId: priorConversation.id });
    const unrelatedConversation = z
      .object({ id: z.string() })
      .parse(context.core.createConversation(context.owner, "Other", "Different thread"));
    context.core.createThread(context.owner, {
      title: "Other thread",
      goal: "Study etiquette",
      conversationId: unrelatedConversation.id,
    });
    const unrelated = createModelKnowledge(context, {
      title: "Etiquette",
      aliases: [],
      statement: "Conventions for social conduct.",
      semanticScope: "social etiquette",
      definitionScope: { domain: "social customs" },
      conversationId: unrelatedConversation.id,
    });
    const content = "Please continue.";

    // When
    const loaded = loadTutorContext(
      context.database,
      context.core,
      {
        owner: context.owner,
        conversationId: context.conversationId,
        messageId: learnerMessage(context, content),
        content,
        assistance: "none",
        selfReport: "neutral",
      },
      [],
    );

    // Then
    expect(loaded.selectedKnowledgeIds).toContain(linked.item.id);
    expect(loaded.selectedKnowledgeIds).not.toContain(unrelated.item.id);
  });
});
