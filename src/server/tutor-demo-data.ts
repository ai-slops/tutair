import { z } from "zod";

type DemoCandidate = {
  readonly artifactType: "definition";
  readonly key: string;
  readonly label: string;
  readonly definition: string;
  readonly semanticScope: string;
  readonly definitionKind: "term_sense" | "concept";
  readonly aliases: readonly string[];
  readonly distinguishingFeatures: readonly string[];
  readonly riskScope: "stable" | "definition-sensitive" | "current-contested" | "high-stakes";
  readonly confidence: number;
  readonly sourceSpans: readonly { readonly start: number; readonly end: number }[];
};

export const candidate = (
  key: string,
  label: string,
  definition: string,
  kind: DemoCandidate["definitionKind"],
  features: readonly string[],
): DemoCandidate => ({
  artifactType: "definition",
  key,
  label,
  definition,
  definitionKind: kind,
  aliases: [],
  distinguishingFeatures: features,
  semanticScope: "finite-state machine modeling",
  riskScope: "stable",
  confidence: 0.72,
  sourceSpans: [],
});
export const fsm = {
  ...candidate(
    "fsm",
    "finite-state machine",
    "A model with a finite set of states and transitions selected by events or conditions.",
    "concept",
    ["finite states", "explicit transition rules"],
  ),
  aliases: ["FSM"],
};
export const state = candidate(
  "state",
  "state",
  "A modeled snapshot containing the information relevant to future behavior.",
  "term_sense",
  ["relevant configuration", "not every physical detail"],
);
export const transition = candidate(
  "transition",
  "transition",
  "A rule that maps a state and event or condition to a next state.",
  "concept",
  ["source state", "trigger", "destination state"],
);
const formal = candidate(
  "formal-specified",
  "formal (specified)",
  "Defined by explicit symbols, states, and rules precise enough to inspect or execute.",
  "term_sense",
  ["technical scope", "explicit rules"],
);
const ceremonial = candidate(
  "formal-ceremonial",
  "formal (ceremonial)",
  "Following established ceremony, etiquette, or convention.",
  "term_sense",
  ["social scope", "ceremony or etiquette"],
);
export const technicalFormal = {
  ...formal,
  label: "formal",
  semanticScope: "technical specification",
};
export const ceremonialFormal = {
  ...ceremonial,
  label: "formal",
  semanticScope: "ceremony and etiquette",
};
export const knownSchema = z.object({
  id: z.string().uuid(),
  revisionId: z.string().uuid(),
  revision: z.number().int().positive(),
  title: z.string(),
  definition: z.string(),
  semanticScope: z.string(),
});
export const values = (data: Readonly<Record<string, unknown>>, key: string): readonly string[] => {
  const value = data[key];
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
};
