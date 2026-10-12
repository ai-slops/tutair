import { z } from "zod";
import { Database } from "../../src/server/database.js";
import type { StructuredCall, TutorProvider } from "../../src/server/provider.js";
import { CoreRepository } from "../../src/server/repository-core.js";
import { KnowledgeRepository } from "../../src/server/repository-knowledge.js";

export const providerState = {
  provider: "demo",
  model: "pipeline-test",
  generation: true,
  synthetic: true,
  embedding: "disabled",
} as const;

export const machine = {
  artifactType: "definition",
  key: "fsm",
  label: "finite-state machine",
  definition: "A finite collection of states and transition rules.",
  semanticScope: "formal system",
  definitionKind: "concept",
  aliases: ["FSM"],
  distinguishingFeatures: ["finite states", "explicit transitions"],
  riskScope: "stable",
  confidence: 0.9,
  sourceSpans: [{ start: 0, end: 8 }],
} as const;

export function stageOutput(call: StructuredCall): unknown {
  switch (call.stage) {
    case "evaluation":
      return { evidence: [], openQuestion: null };
    case "extraction":
      return {
        goal: "Model a door controller",
        sourceLanguage: "en",
        responseLanguage: "en",
        artifacts: [machine],
        relations: [],
      };
    case "resolution":
      return {
        matches: [],
        admissions: Array.isArray(call.data["candidates"])
          ? call.data["candidates"].flatMap((candidate) =>
              typeof candidate === "object" && candidate !== null
                ? [
                    {
                      candidateKey: "key" in candidate ? candidate.key : "",
                      artifactType: "definition",
                      verdict: "approve",
                      reviewLabel: "resolution-stage model review",
                      checks: {
                        durableIdentity: true,
                        boundedMeaning: true,
                        reusableBeyondCurrentAnswer: true,
                      },
                      reasons: ["test_validated"],
                    },
                  ]
                : [],
            )
          : [],
      };
    case "planning":
      return {
        move: "answer_then_apply",
        currentGoal: "Build the controller",
        intent: "teach",
        targetUnits: [],
        assumedUnits: [],
        introducedUnits: [],
        deferredUnits: [],
        deferredQuestions: [],
        materialNeeds: z
          .array(z.object({ revisionId: z.string() }))
          .catch([])
          .parse(call.data["knowledge"])
          .map((item) => ({
            knowledgeRevisionId: item.revisionId,
            blockTypes: ["definition"] as const,
          })),
        assessmentOpportunities: [
          {
            prompt: "Ask for the next transition",
            targetKnowledgeIds: [],
            dimensions: ["application"],
            naturalAfter: "the worked example",
          },
        ],
        responseStrategy: "answer_first",
        interruptionJustified: false,
      };
    case "draft":
      return { text: "A finite-state machine models the controller." };
    case "preparation": {
      const missing = Array.isArray(call.data["missingKnowledgeRevisionIds"])
        ? call.data["missingKnowledgeRevisionIds"].filter(
            (id): id is string => typeof id === "string",
          )
        : [];
      return {
        materials: missing.map((knowledgeRevisionId) => ({
          knowledgeRevisionId,
          englishBlocks: [
            { type: "definition", content: "A finite-state machine models the controller." },
          ],
          localizedBlocks: [],
        })),
      };
    }
    case "lint":
      return {
        safe: true,
        issues: [],
        concepts: [
          {
            concept: "determinism",
            centrality: 0.9,
            learnerUncertainty: 0.8,
            misunderstandingCost: 0.8,
            action: "define_inline",
            knownKnowledgeId: null,
          },
        ],
        generatedCandidates: [{ ...machine, key: "determinism", label: "determinism" }],
        lintSkipped: false,
      };
    case "final":
      return {
        segments: Array.isArray(call.data["availableBlocks"])
          ? call.data["availableBlocks"].flatMap((block) =>
              typeof block === "object" &&
              block !== null &&
              "id" in block &&
              typeof block.id === "string"
                ? [{ blockId: block.id, layout: "paragraph" }]
                : [],
            )
          : [],
      };
  }
}

export type TutorTestContext = {
  readonly database: Database;
  readonly core: CoreRepository;
  readonly knowledge: KnowledgeRepository;
  readonly owner: string;
  readonly conversationId: string;
};

export function createTutorTestContext(
  databases: Database[],
  title: string,
  goal: string,
): TutorTestContext {
  const database = new Database(":memory:");
  databases.push(database);
  const core = new CoreRepository(database);
  const knowledge = new KnowledgeRepository(database);
  const signup = z.object({ learner: z.object({ id: z.string() }) }).parse(core.signup("Ada"));
  const conversation = z
    .object({ id: z.string() })
    .parse(core.createConversation(signup.learner.id, title, goal));
  return {
    database,
    core,
    knowledge,
    owner: signup.learner.id,
    conversationId: conversation.id,
  };
}

export function providerFor(
  output: (call: StructuredCall) => unknown = stageOutput,
  calls?: StructuredCall[],
): TutorProvider {
  return {
    state: providerState,
    embeddingProfile: "disabled:v1",
    async call(call) {
      calls?.push(call);
      return { value: output(call), usage: null };
    },
  };
}

export function learnerMessage(context: TutorTestContext, content: string): string {
  return z
    .object({ id: z.string() })
    .parse(context.core.createMessage(context.owner, context.conversationId, "learner", content))
    .id;
}
