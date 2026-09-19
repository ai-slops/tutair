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
  key: "fsm",
  label: "finite-state machine",
  definition: "A finite collection of states and transition rules.",
  semanticScope: "formal system",
  kind: "concept",
  aliases: ["FSM"],
  distinguishingFeatures: ["finite states", "explicit transitions"],
  claims: ["Transitions select a next state"],
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
        targets: [machine],
        prerequisites: [],
        terms: [],
        distinctions: [
          {
            ...machine,
            key: "formal-senses",
            label: "formal versus ceremonial",
            kind: "distinction",
          },
        ],
        misconceptions: [],
        claims: [],
        relations: [],
      };
    case "resolution":
      return { matches: [], provisional: [] };
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
      return { text: "A finite-state machine models the controller.", exposures: [] };
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
