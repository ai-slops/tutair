import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Database } from "../../src/server/database.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import { KnowledgeRepository } from "../../src/server/repository-knowledge.js";
import { MisconceptionRepository } from "../../src/server/repository-misconceptions.js";

const databases: Database[] = [];
afterEach(() => databases.splice(0).forEach((database) => void database.close()));

function fixture() {
  const database = new Database(":memory:");
  databases.push(database);
  const core = new CoreRepository(database);
  const owner = z.object({ id: z.string() }).parse(core.signup("Ada").learner).id;
  const knowledge = new KnowledgeRepository(database);
  const definition = knowledge.create(owner, {
    title: "State",
    statement: "A configuration relevant to future behavior.",
    kind: "concept",
    riskScope: "stable",
    confidence: 0.9,
    sourceType: "learner_manual",
  });
  const revisionId = z.object({ id: z.string() }).parse(definition.revision).id;
  return {
    database,
    owner,
    knowledge,
    revisionId,
    misconceptions: new MisconceptionRepository(database),
  };
}

const details = {
  label: "States are events",
  mistakenProposition: "A state is an event.",
  correction: "A state persists; an event triggers change.",
  failureTask: "Trace a turnstile transition.",
  likelyError: "Labels coin as a state.",
  discriminatingExample: {
    scenario: "A locked turnstile receives a coin.",
    mistakenResponse: "Coin is the state.",
    correctedResponse: "Unlocked is the state.",
    decisiveCue: "Unlocked persists after the coin event.",
  },
  reuseValueReason: "The distinction recurs in event-driven systems.",
  sourceRefs: ["source:test"] as string[],
} as const;

describe("misconception lifecycle", () => {
  it("stores misconceptions outside knowledge items and exactly reuses a fingerprint", () => {
    const context = fixture();
    const input = {
      ...details,
      definitionRevisionLinks: [
        {
          definitionRevisionId: context.revisionId,
          role: "subject" as const,
          learningValue: "Separates persistent configuration from the triggering event.",
        },
      ],
      sourceType: "model_generated" as const,
      extractionRunId: "11111111-1111-4111-8111-111111111112",
      resolutionRunId: "11111111-1111-4111-8111-111111111113",
      modelReview: {
        rubricVersion: "typed-admission-v1" as const,
        checks: {},
        reasons: ["Concrete and reusable."],
      },
    };

    const first = context.misconceptions.createOrReuse(context.owner, input);
    const second = context.misconceptions.createOrReuse(context.owner, input);

    expect(second.id).toBe(first.id);
    expect(context.knowledge.list(context.owner)).toHaveLength(1);
    expect(context.misconceptions.list(context.owner)).toHaveLength(1);
  });

  it("excludes stale linked revisions and restores only after an explicit corrected revision", () => {
    const context = fixture();
    const created = context.misconceptions.createOrReuse(context.owner, {
      ...details,
      definitionRevisionLinks: [
        {
          definitionRevisionId: context.revisionId,
          role: "subject",
          learningValue: "Names the definition whose confusion causes the error.",
        },
      ],
      sourceType: "learner_manual",
      sourceRefs: [],
      modelReview: null,
      extractionRunId: null,
      resolutionRunId: null,
    });
    const item = z.object({ id: z.string() }).parse(context.knowledge.list(context.owner)[0]);

    context.knowledge.addRevision(context.owner, {
      knowledgeId: item.id,
      statement: "A revised definition.",
      sourceType: "learner_manual",
      sourceRef: null,
    });

    expect(context.misconceptions.eligible(context.owner).map((entry) => entry.id)).not.toContain(
      created.id,
    );
    expect(context.misconceptions.list(context.owner)[0]?.eligibilityReason).toBe(
      "stale_definition_link",
    );
  });

  it("keeps revisions and review events immutable", () => {
    const context = fixture();
    const created = context.misconceptions.createOrReuse(context.owner, {
      ...details,
      definitionRevisionLinks: [
        {
          definitionRevisionId: context.revisionId,
          role: "subject",
          learningValue: "Supports the correction.",
        },
      ],
      sourceType: "learner_manual",
      sourceRefs: [],
      modelReview: null,
      extractionRunId: null,
      resolutionRunId: null,
    });
    const reviewed = context.misconceptions.review(
      context.owner,
      created.id,
      "reviewed",
      null,
      false,
    );

    expect(() =>
      context.database.run(
        "UPDATE misconception_revisions SET correction='changed' WHERE misconception_id=?",
        [created.id],
      ),
    ).toThrow(/immutable/i);
    expect(() =>
      context.database.run("DELETE FROM misconception_review_events WHERE id=?", [reviewed.id]),
    ).toThrow(/immutable/i);
  });

  it("restores retirement without erasing an incorrect accuracy review", () => {
    const context = fixture();
    const created = context.misconceptions.createOrReuse(context.owner, {
      ...details,
      definitionRevisionLinks: [
        {
          definitionRevisionId: context.revisionId,
          role: "subject",
          learningValue: "Supports the correction against the exact definition.",
        },
      ],
      sourceType: "learner_manual",
      sourceRefs: [],
      modelReview: null,
      extractionRunId: null,
      resolutionRunId: null,
    });

    context.misconceptions.review(context.owner, created.id, "mark_incorrect", "Wrong", false);
    context.misconceptions.review(context.owner, created.id, "retire", "Not useful now", false);
    context.misconceptions.review(context.owner, created.id, "restore", null, true);

    const restored = context.misconceptions.get(context.owner, created.id);
    expect(restored.reviewStatus).toBe("incorrect");
    expect(restored.eligibilityReason).toBe("incorrect");
  });

  it("orders same-millisecond review events by insertion order", () => {
    const context = fixture();
    const created = context.misconceptions.createOrReuse(context.owner, {
      ...details,
      definitionRevisionLinks: [
        {
          definitionRevisionId: context.revisionId,
          role: "subject",
          learningValue: "Supports the correction against the exact definition.",
        },
      ],
      sourceType: "learner_manual",
      sourceRefs: [],
      modelReview: null,
      extractionRunId: null,
      resolutionRunId: null,
    });
    const timestamp = "2026-10-12T00:00:00.000Z";
    context.database.run("INSERT INTO misconception_review_events VALUES(?,?,?,?,?,?,?)", [
      "ffffffff-ffff-4fff-8fff-ffffffffffff",
      created.id,
      created.revisionId,
      context.owner,
      "mark_incorrect",
      "Wrong",
      timestamp,
    ]);
    context.database.run("INSERT INTO misconception_review_events VALUES(?,?,?,?,?,?,?)", [
      "00000000-0000-4000-8000-000000000001",
      created.id,
      created.revisionId,
      context.owner,
      "reviewed",
      null,
      timestamp,
    ]);

    const item = context.misconceptions.get(context.owner, created.id);
    expect(item.reviewHistory.map((event) => event.action)).toEqual(["mark_incorrect", "reviewed"]);
    expect(item.reviewStatus).toBe("reviewed");
  });

  it("requires explicit confirmation before restoring retirement", () => {
    const context = fixture();
    const created = context.misconceptions.createOrReuse(context.owner, {
      ...details,
      definitionRevisionLinks: [
        {
          definitionRevisionId: context.revisionId,
          role: "subject",
          learningValue: "Supports the correction against the exact definition.",
        },
      ],
      sourceType: "learner_manual",
      sourceRefs: [],
      modelReview: null,
      extractionRunId: null,
      resolutionRunId: null,
    });

    expect(() =>
      context.misconceptions.review(context.owner, created.id, "restore", null, false),
    ).toThrow(/confirmation/i);
  });

  it("allows a reviewed accuracy event to supersede an incorrect event", () => {
    const context = fixture();
    const created = context.misconceptions.createOrReuse(context.owner, {
      ...details,
      definitionRevisionLinks: [
        {
          definitionRevisionId: context.revisionId,
          role: "subject",
          learningValue: "Supports the correction against the exact definition.",
        },
      ],
      sourceType: "learner_manual",
      sourceRefs: [],
      modelReview: null,
      extractionRunId: null,
      resolutionRunId: null,
    });
    context.misconceptions.review(context.owner, created.id, "mark_incorrect", "Wrong", false);

    context.misconceptions.review(context.owner, created.id, "reviewed", null, false);

    expect(context.misconceptions.get(context.owner, created.id).reviewStatus).toBe("reviewed");
    expect(context.misconceptions.get(context.owner, created.id).eligibilityReason).toBeNull();
  });
});
