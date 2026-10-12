import { describe, expect, it } from "vitest";
import { renderSelection } from "../../src/server/answer-composition.js";
import {
  preparationSchema,
  preparationSchemaFor,
} from "../../src/server/document-answer-contracts.js";
import { extractionSchema } from "../../src/server/tutor-schemas.js";

const revisionId = (index: number): string =>
  `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;

describe("document answer contracts", () => {
  it("accepts 24 English blocks with their 24 localized expressions", () => {
    const materials = Array.from({ length: 24 }, (_, index) => ({
      knowledgeRevisionId: revisionId(index),
      englishBlocks: [{ type: "definition" as const, content: `English definition ${index}` }],
      localizedBlocks: [
        {
          type: "definition" as const,
          content: `한국어 정의 ${index}`,
          sourceEnglishIndex: 0,
        },
      ],
    }));

    expect(preparationSchemaFor(new Set()).safeParse({ materials }).success).toBe(true);
  });

  it("rejects more than 24 blocks in one language", () => {
    const materials = [
      {
        knowledgeRevisionId: revisionId(0),
        englishBlocks: Array.from({ length: 24 }, (_, index) => ({
          type: "claim" as const,
          content: `Claim ${index}`,
        })),
        localizedBlocks: [],
      },
      {
        knowledgeRevisionId: revisionId(1),
        englishBlocks: [{ type: "claim" as const, content: "One excess claim" }],
        localizedBlocks: [],
      },
    ];

    expect(preparationSchema.safeParse({ materials }).success).toBe(false);
  });

  it("preserves Korean aliases and renders exact localized document blocks", () => {
    const extracted = extractionSchema.parse({
      goal: "Explain the relationship between propositional and classical logic.",
      sourceLanguage: "ko",
      responseLanguage: "ko",
      targets: [
        {
          key: "propositional-logic",
          label: "propositional logic",
          definition: "A logical system whose basic units are whole propositions.",
          semanticScope: "formal logic",
          kind: "concept",
          aliases: ["명제 논리"],
          distinguishingFeatures: ["Whole propositions are the basic units."],
          claims: [],
          riskScope: "stable",
          confidence: 0.95,
          sourceSpans: [{ start: 0, end: 5 }],
          classification: "knowledge_unit",
        },
      ],
      prerequisites: [],
      terms: [],
      distinctions: [],
      misconceptions: [],
      claims: [],
      relations: [],
    });
    const localized = "‘명제 논리’는 문장 전체를 기본 단위로 다룹니다.";
    const rendered = renderSelection(
      { segments: [{ blockId: revisionId(7), layout: "paragraph" }] },
      [{ id: revisionId(7), content: localized, contentHash: "unused" }],
    );

    expect(extracted.targets[0]?.aliases).toEqual(["명제 논리"]);
    expect(rendered.text).toBe(localized);
  });
});
