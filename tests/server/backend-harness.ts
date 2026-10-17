import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { createApp } from "../../src/server/app.js";
import type { StructuredCall, TutorProvider } from "../../src/server/provider.js";

export type Json = Record<string, unknown> &
  Record<
    | "id"
    | "conversation"
    | "conversationId"
    | "conversations"
    | "embedding"
    | "error"
    | "evidence"
    | "exposures"
    | "imported"
    | "item"
    | "knowledgeChanges"
    | "learnerState"
    | "mastery"
    | "message"
    | "messages"
    | "mode"
    | "results"
    | "revisions"
    | "run"
    | "search"
    | "stages"
    | "status"
    | "synthetic"
    | "thread"
    | "tutorMessage"
    | "weight"
    | "dimension",
    unknown
  >;
export type Client = {
  readonly call: (path: string, init?: RequestInit) => Promise<Response>;
  readonly json: (path: string, init?: RequestInit) => Promise<Json>;
};

const scriptedValue = (call: StructuredCall): unknown => {
  const candidate = {
    artifactType: "definition",
    key: "claim",
    label: "Claim",
    definition: "Tentative claim",
    semanticScope: "test",
    definitionKind: "concept",
    aliases: [],
    distinguishingFeatures: [],
    riskScope: "stable",
    confidence: 0.4,
    sourceSpans: [],
  } as const;
  switch (call.stage) {
    case "extraction":
      return {
        goal: "Test the current claim",
        sourceLanguage: "en",
        responseLanguage: "en",
        artifacts: [candidate],
        relations: [],
      };
    case "resolution":
      return {
        matches: [],
        admissions: Array.isArray(call.data["candidates"])
          ? call.data["candidates"].flatMap((item) =>
              typeof item === "object" && item !== null
                ? [
                    {
                      candidateKey: "key" in item ? item.key : "",
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
        move: "probe",
        currentGoal: "Test the current claim",
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
            blockTypes: ["definition", "example"] as const,
          })),
        assessmentOpportunities: [],
        responseStrategy: "probe",
        interruptionJustified: false,
      };
    case "draft":
      return { text: "Which example would test it?" };
    case "preparation":
      return {
        materials: Array.isArray(call.data["missingKnowledgeRevisionIds"])
          ? call.data["missingKnowledgeRevisionIds"].flatMap((knowledgeRevisionId) =>
              typeof knowledgeRevisionId === "string"
                ? [
                    {
                      knowledgeRevisionId,
                      englishBlocks: [
                        { type: "definition", content: "Tentative claim" },
                        { type: "example", content: "Which example would test it?" },
                      ],
                      localizedBlocks: [],
                    },
                  ]
                : [],
            )
          : [],
      };
    case "lint":
      return { safe: true, issues: [], concepts: [], generatedCandidates: [], lintSkipped: false };
    case "final": {
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
    case "evaluation":
      return { evidence: [], openQuestion: "Find a counterexample" };
  }
};
const scriptedCall = async (call: StructuredCall) => ({ value: scriptedValue(call), usage: null });

export const scripted = (embedding = false): TutorProvider =>
  embedding
    ? {
        embeddingProfile: "test:embedding:v1",
        state: {
          provider: "demo",
          model: "test",
          generation: true,
          synthetic: true,
          embedding: "configured",
        },
        call: scriptedCall,
        embed: async (texts) =>
          texts.map((text) => [text.includes("gravity") ? 1 : 0, text.includes("plant") ? 1 : 0]),
      }
    : {
        embeddingProfile: "disabled:v1",
        state: {
          provider: "demo",
          model: "test",
          generation: true,
          synthetic: true,
          embedding: "disabled",
        },
        call: scriptedCall,
      };

export const makeClient = (app: ReturnType<typeof createApp>["app"]): Client => {
  let cookie = "";
  const call = async (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (cookie !== "") headers.set("cookie", cookie);
    if (init.body !== undefined) headers.set("content-type", "application/json");
    const response = await app.request(`http://localhost${path}`, { ...init, headers });
    const issued = response.headers.get("set-cookie");
    if (issued !== null) cookie = issued.split(";")[0] ?? "";
    return response;
  };
  return { call, json: async (path, init) => (await call(path, init)).json() as Promise<Json> };
};

export const post = (body: unknown): RequestInit => ({
  method: "POST",
  body: JSON.stringify(body),
});

export const canonicalPost = (body: unknown): RequestInit => ({
  ...post(body),
  headers: { "x-tutair-canonical-token": "test-canonical-token" },
});

export const createBackendHarness = () => {
  let directory = "";
  let close: (() => Promise<void>) | undefined;
  return {
    setup(provider = scripted()) {
      directory = mkdtempSync(join(tmpdir(), "tutair-test-"));
      const created = createApp({
        databasePath: join(directory, "test.sqlite"),
        provider,
        env: { ...process.env, TUTOR_CANONICAL_IMPORT_TOKEN: "test-canonical-token" },
      });
      close = async () => {
        await created.runtime.dispose();
        created.database.close();
      };
      return { client: makeClient(created.app), app: created.app, database: created.database };
    },
    reset() {
      directory = "";
      close = undefined;
    },
    async cleanup() {
      await close?.();
      if (directory !== "") rmSync(directory, { recursive: true, force: true });
    },
  };
};
