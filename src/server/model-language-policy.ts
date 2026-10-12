import type { Stage } from "./provider.js";

const observablePolicy = {
  observableIntermediateLanguage: "en",
  responseLanguageSource: "question_bcp47",
  preserveVerbatim: ["user_source_quotes"],
  allowedNonEnglish: ["proper_terms", "localized_aliases"],
  providerReasoningSummaryLanguage: "provider_controlled",
} as const;

export const modelLanguagePolicy = (stage: Stage) => {
  switch (stage) {
    case "preparation":
      return {
        ...observablePolicy,
        output: "english_base_and_localized_output_material",
        englishBaseLanguage: "en",
        localizedContentLanguage: "responseLanguage",
        localizedContentRole: "learner_facing_output_material",
      } as const;
    case "final":
      return {
        ...observablePolicy,
        output: "selection_ids_and_layout_only",
        rendering: "server",
        learnerFacingLanguage: "responseLanguage",
      } as const;
    case "extraction":
    case "resolution":
    case "planning":
    case "draft":
    case "lint":
    case "evaluation":
      return { ...observablePolicy, output: "structured_intermediate" } as const;
  }
};
