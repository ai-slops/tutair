import { ApiError } from "./types.js";

export const MODEL_CONTEXT_TEXT_BUDGET = 32_000;
export const MODEL_CONTEXT_JSON_BUDGET = 96_000;

const preservedStringField =
  /(?:^id$|_id$|_ids_json$|Id$|Ids$|^key$|Key$|revision|[sS]cope|kind|type|status|role|dimension|decision|intent|action|polarity|created_at|updated_at|projected_at|last_observation)/u;

const fieldPriority = new Map(
  [
    "draft",
    "currentGoal",
    "message",
    "candidates",
    "resolutionCandidates",
    "knowledge",
    "micrograph",
    "plan",
    "lint",
    "learnerStates",
    "supportingEvidence",
    "relations",
    "openQuestions",
    "recentContext",
    "relevantHistory",
    "definition",
    "statement",
    "title",
    "semanticScope",
    "content",
    "question",
    "aliases",
    "distinguishingFeatures",
    "claims",
  ].map((key, index) => [key, index]),
);

type TextAllowance = { remaining: number; strings: number };

function orderedEntries(value: object): readonly (readonly [string, unknown])[] {
  return Object.entries(value).toSorted(([left], [right]) => {
    const leftPriority = fieldPriority.get(left) ?? fieldPriority.size;
    const rightPriority = fieldPriority.get(right) ?? fieldPriority.size;
    return leftPriority - rightPriority || left.localeCompare(right);
  });
}

function boundValue(value: unknown, field: string, allowance: TextAllowance): unknown {
  if (typeof value === "string") {
    if (preservedStringField.test(field)) return value;
    if (value.length === 0) return value;
    const reserved = Math.max(allowance.strings - 1, 0);
    const available = Math.max(allowance.remaining - reserved, 0);
    const excerpt = Array.from(value).slice(0, available).join("");
    allowance.remaining -= Array.from(excerpt).length;
    allowance.strings -= 1;
    return excerpt;
  }
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => boundValue(item, field, allowance));
  if (typeof value !== "object") return null;
  const output: Record<string, unknown> = {};
  for (const [key, child] of orderedEntries(value)) output[key] = boundValue(child, key, allowance);
  return output;
}

function countTextStrings(value: unknown, field = ""): number {
  if (typeof value === "string")
    return value.length > 0 && !preservedStringField.test(field) ? 1 : 0;
  if (Array.isArray(value))
    return value.reduce((total, item) => total + countTextStrings(item, field), 0);
  if (value === null || typeof value !== "object") return 0;
  return Object.entries(value).reduce(
    (total, [key, child]) => total + countTextStrings(child, key),
    0,
  );
}

function boundedObject(
  input: Readonly<Record<string, unknown>>,
  textBudget: number,
): Readonly<Record<string, unknown>> {
  const allowance: TextAllowance = { remaining: textBudget, strings: countTextStrings(input) };
  const output: Record<string, unknown> = {};
  for (const [key, child] of orderedEntries(input)) output[key] = boundValue(child, key, allowance);
  return output;
}

export function modelContextTextSize(value: unknown, field = ""): number {
  if (typeof value === "string")
    return preservedStringField.test(field) ? 0 : Array.from(value).length;
  if (Array.isArray(value))
    return value.reduce((total, item) => total + modelContextTextSize(item, field), 0);
  if (value === null || typeof value !== "object") return 0;
  return Object.entries(value).reduce(
    (total, [key, child]) => total + modelContextTextSize(child, key),
    0,
  );
}

export function boundModelContext(
  input: Readonly<Record<string, unknown>>,
): Readonly<Record<string, unknown>> {
  const metadataOnly = boundedObject(input, 0);
  if (JSON.stringify(metadataOnly).length > MODEL_CONTEXT_JSON_BUDGET)
    throw new ApiError(
      422,
      "model_context_metadata_too_large",
      "Model context metadata exceeds the fixed payload budget",
    );
  let lower = 0;
  let upper = MODEL_CONTEXT_TEXT_BUDGET;
  let result = metadataOnly;
  while (lower <= upper) {
    const midpoint = Math.floor((lower + upper) / 2);
    const candidate = boundedObject(input, midpoint);
    if (JSON.stringify(candidate).length <= MODEL_CONTEXT_JSON_BUDGET) {
      result = candidate;
      lower = midpoint + 1;
    } else upper = midpoint - 1;
  }
  if (typeof input["draft"] === "string" && result["draft"] !== input["draft"])
    throw new ApiError(
      422,
      "model_context_draft_too_large",
      "A draft cannot be partially safety-checked",
    );
  return result;
}
