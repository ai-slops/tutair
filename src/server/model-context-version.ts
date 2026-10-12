import { createHash } from "node:crypto";
import type { Stage, StructuredCall } from "./provider.js";

export const MODEL_CONTEXT_VERSION = "model-context-v2";

export const STAGE_VERSIONS = {
  extraction: "typed-admission-v1",
  resolution: "typed-admission-v1",
  planning: "document-v2",
  preparation: "document-v2",
  draft: "phase1-v1",
  lint: "phase1-v1",
  final: "phase1-v1",
  evaluation: "phase1-evaluation-v2",
} as const satisfies Readonly<Record<Stage, string>>;

export const STAGE_SCHEMA_VERSIONS = {
  extraction: "document-schema-v4",
  resolution: "document-schema-v3",
  planning: "document-schema-v2",
  preparation: "document-schema-v3",
  draft: "phase1-schema-v2",
  lint: "phase1-schema-v3",
  final: "phase1-schema-v2",
  evaluation: "phase1-evaluation-schema-v3",
} as const satisfies Readonly<Record<Stage, string>>;

export const PROMPT_SCHEMA_VERSIONS = {
  prompt: "document-prompt-v3",
  compatibilityPrompt: "document-prompt-v3-compatibility",
  schema: "document-schema-v2",
  evaluationSchema: "phase1-evaluation-schema-v3",
} as const;

export const canonicalJson = (value: unknown): string =>
  JSON.stringify(value, (_key, nested: unknown) => {
    if (nested === null || Array.isArray(nested) || typeof nested !== "object") return nested;
    return Object.fromEntries(
      Object.entries(nested).toSorted(([left], [right]) => left.localeCompare(right)),
    );
  });

export const modelContextSnapshot = (
  call: StructuredCall,
): { readonly json: string; readonly hash: string } => {
  const json = canonicalJson(call);
  return { json, hash: createHash("sha256").update(json).digest("hex") };
};
