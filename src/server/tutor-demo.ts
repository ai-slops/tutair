import { z } from "zod";
import type { StructuredCall } from "./provider.js";
import {
  ceremonialFormal,
  fsm,
  knownSchema,
  state,
  technicalFormal,
  transition,
  values,
} from "./tutor-demo-data.js";
import { candidateSchema } from "./tutor-schemas.js";

export function demoCall(call: StructuredCall): unknown {
  const message = typeof call.data["message"] === "string" ? call.data["message"] : "";
  switch (call.stage) {
    case "extraction":
      return {
        goal: message || "Understand finite-state machines",
        sourceLanguage: "en",
        responseLanguage: "en",
        artifacts: [fsm, state, transition, technicalFormal, ceremonialFormal],
        relations: [
          {
            fromKey: "state",
            toKey: "fsm",
            type: "prerequisite",
            necessity: 0.7,
            scaffoldable: true,
          },
          { fromKey: "transition", toKey: "fsm", type: "part", necessity: 0.9, scaffoldable: true },
          {
            fromKey: "formal-specified",
            toKey: "formal-ceremonial",
            type: "contrast",
            necessity: 0.4,
            scaffoldable: true,
          },
        ],
      };
    case "resolution": {
      const candidates = z.array(candidateSchema).safeParse(call.data["candidates"]);
      const known = z.array(knownSchema).safeParse(call.data["resolutionCandidates"]);
      const existing = known.success ? known.data : [];
      const pending = candidates.success ? candidates.data : [];
      return {
        matches: pending.flatMap((item) => {
          const found = existing.find(
            (knownItem) =>
              knownItem.title.toLocaleLowerCase() === item.label.toLocaleLowerCase() &&
              item.artifactType === "definition" &&
              knownItem.semanticScope === item.semanticScope,
          );
          return found === undefined
            ? []
            : [
                {
                  candidateKey: item.key,
                  knowledgeId: found.id,
                  revision: found.revision,
                  confidence: 1,
                  decision: "exact" as const,
                  reasonCodes: ["same_label_same_scope"],
                },
              ];
        }),
        admissions: pending
          .filter(
            (item) =>
              !existing.some(
                (knownItem) =>
                  knownItem.title.toLocaleLowerCase() === item.label.toLocaleLowerCase() &&
                  item.artifactType === "definition" &&
                  knownItem.semanticScope === item.semanticScope,
              ),
          )
          .flatMap((item) =>
            item.artifactType === "definition"
              ? [
                  {
                    candidateKey: item.key,
                    artifactType: "definition" as const,
                    verdict: "approve" as const,
                    reviewLabel: "resolution-stage model review" as const,
                    rubricVersion: "typed-admission-v1" as const,
                    checks: {
                      durableIdentity: true as const,
                      boundedMeaning: true as const,
                      reusableBeyondCurrentAnswer: true as const,
                    },
                    reasons: ["independently_validated_named_concept"],
                  },
                ]
              : [],
          ),
      };
    }
    case "planning":
      return {
        move: "answer_then_apply",
        currentGoal: String(call.data["currentGoal"] ?? message),
        intent: "teach",
        targetUnits: values(call.data, "knowledgeIds"),
        assumedUnits: [],
        introducedUnits: values(call.data, "knowledgeIds").slice(0, 3),
        deferredUnits: [],
        deferredQuestions: [],
        materialNeeds: z.array(knownSchema).safeParse(call.data["knowledge"]).success
          ? z
              .array(knownSchema)
              .parse(call.data["knowledge"])
              .map((item) => ({
                knowledgeRevisionId: item.revisionId,
                blockTypes: ["definition", "example"] as const,
              }))
          : [],
        assessmentOpportunities: [
          {
            prompt: "Add the next state and transition for a jammed door.",
            targetKnowledgeIds: values(call.data, "knowledgeIds").slice(0, 3),
            dimensions: ["application"],
            naturalAfter: "the door-controller example",
          },
        ],
        responseStrategy: "concrete_model_then_check",
        interruptionJustified: false,
      };
    case "preparation": {
      const missing = values(call.data, "missingKnowledgeRevisionIds");
      const knowledge = z.array(knownSchema).safeParse(call.data["knowledge"]);
      const known = knowledge.success ? knowledge.data : [];
      return {
        materials: missing.map((revisionId) => {
          const item = known.find((candidate) => candidate.revisionId === revisionId);
          return {
            knowledgeRevisionId: revisionId,
            englishBlocks: [
              {
                type: "definition",
                content:
                  item === undefined
                    ? "This concept supports the current learning goal."
                    : `${item.title} is ${item.definition}`,
              },
              {
                type: "example",
                content:
                  item === undefined
                    ? "A concrete example applies this concept to the current question."
                    : `For the current question, use ${item.title} in a concrete worked example.`,
              },
            ],
            localizedBlocks: [],
          };
        }),
      };
    }
    case "draft":
      return {
        text: "An FSM (finite-state machine) models behavior using a finite set of states and transitions. A state is the situation relevant to what can happen next; a transition is a rule for moving to another state after an event.\n\nFor a door: Locked --coin--> Unlocked, then Unlocked --push--> Locked. Here ‘formal’ means explicitly specified, not ceremonial.\n\nWhat state and transition would you add for a jammed door?",
      };
    case "lint":
      return {
        safe: true,
        issues: [],
        generatedCandidates: [],
        lintSkipped: false,
        concepts: [
          {
            concept: "state",
            centrality: 1,
            learnerUncertainty: 0.7,
            misunderstandingCost: 0.8,
            action: "define_inline",
            knownKnowledgeId: null,
          },
          {
            concept: "transition",
            centrality: 1,
            learnerUncertainty: 0.7,
            misunderstandingCost: 0.8,
            action: "give_example",
            knownKnowledgeId: null,
          },
          {
            concept: "ceremonial formality",
            centrality: 0.2,
            learnerUncertainty: 0.7,
            misunderstandingCost: 0.1,
            action: "allow",
            knownKnowledgeId: null,
          },
        ],
      };
    case "final": {
      const blocks = z.array(z.object({ id: z.string() })).safeParse(call.data["availableBlocks"]);
      return {
        segments: (blocks.success ? blocks.data : []).map((block) => ({
          blockId: block.id,
          layout: "paragraph",
        })),
      };
    }
    case "evaluation": {
      const parsed = z.array(knownSchema).safeParse(call.data["knowledge"]);
      const known = parsed.success ? parsed.data : [];
      const application = /locked|unlocked|door|--.*-->/iu.test(message);
      const explanation =
        /\b(?:fsm|finite-state machine)\b.{0,30}\b(?:is|means|models|has)\b/iu.test(message);
      const target = known.find((item) => item.title === "finite-state machine");
      return {
        evidence:
          target === undefined || (!application && !explanation)
            ? []
            : [
                {
                  knowledgeId: target.id,
                  knowledgeRevisionId: target.revisionId,
                  revision: target.revision,
                  dimension: application ? "application" : "explanation",
                  evidenceType: application ? "application" : "free_explanation",
                  polarity: "positive",
                  score: 0.82,
                  evaluatorConfidence: 0.72,
                  ambiguous: false,
                  copied: false,
                  sourceSpans: [{ start: 0, end: Math.max(message.length, 1) }],
                  limitations: application ? ["single familiar application"] : [],
                  relatedKnowledgeIds: [],
                  assessmentId: null,
                  threadId: null,
                  difficulty: 0.45,
                },
              ],
        openQuestion: message ? "What transition should happen from the new state?" : null,
      };
    }
  }
}
