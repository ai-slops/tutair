# Observable language and incident contract

Status: normative application contract, October 12, 2026.

## Observable language boundary

Tutair does not request, expose, translate, or claim control over hidden model
reasoning. The language contract applies only to observable structured fields sent
through the application pipeline:

- Generated extraction labels, definitions, semantic scopes, definition scopes,
  distinguishing features, and claims are English.
- Resolution decisions and textual planning fields are English. Machine enums,
  UUIDs, and block types retain their schema-defined representation.
- Exact user/source quotations remain verbatim. Non-English proper terms and
  localized aliases may remain in their source language; an ASCII-only heuristic
  is not a validity rule.
- Extraction must return explicit BCP-47 `sourceLanguage` and `responseLanguage`
  values. `responseLanguage` is detected from the current question and has no
  implicit English default.
- Preparation always creates English `englishBlocks`. When `responseLanguage` is
  not `en`, `localizedBlocks` contain target-language learner-facing output
  material linked by `sourceEnglishIndex`. Localized blocks are output material,
  not internal analysis.
- Final generation returns only selected block IDs and layout enums. The server
  renders the selected blocks, so the learner-facing answer uses the prepared
  localization without reopening a free-prose final channel.
- Public provider reasoning summaries are provider-controlled fields. Tutair does
  not guarantee their language and does not translate or fabricate them.

Each provider call includes a machine-readable `languagePolicy` snapshot. This
makes the requested boundary observable in generation inspection and distinguishes
English intermediate material from target-language output material.

## Guarantee extent

The application guarantees schema requirements, policy presence on the recorded
call, exact source/localization links, and deterministic final rendering. Synthetic
tests prove those instructions, boundaries, and rendering mechanics. They cannot
prove that every external model will obey a natural-language instruction or that
English text is semantically correct. Real-provider compliance remains an observed
quality property, not a type-level guarantee.

No text-language regex rejects mathematics, names, symbols, quotations, or
localized aliases. Semantic language and translation quality require review rather
than character-set guesses.

## October 12 failed-turn diagnosis

The latest failed turn was an application contract failure, not a transport,
timeout, cancellation, retry-lifecycle, or vendor-wire failure. Evaluation,
extraction, resolution, and planning completed through the ChatGPT Responses
adapter. Preparation then produced two complete provider responses which the local
Zod boundary rejected as `structured_output_invalid`.

The first preparation response omitted the required English definition block for
three newly generated non-concept units. The repair added those definitions, but
the result contained 13 English blocks and 13 localized blocks. The old schema
counted both representations together and rejected the 26 rows against a 24-total
limit. More importantly, the accepted plan requested 14 block types in English and
the same 14 localized expressions, so exact compliance required at least 28 rows.
The plan and preparation schema were therefore mutually unsatisfiable.

The limit now applies independently per representation: at most 24 English blocks
and at most 24 localized blocks, while the existing 20,000-character bound remains.
This fixes the contradictory application contract without changing the shared
ChatGPT runtime or making another paid call.

## Reported node lineage

The three reported titles were created from the same successful extraction and
resolution sequence before preparation failed:

| Reported title | Stored kind | Scope and origin | Resolution decision | Later review/document state |
| --- | --- | --- | --- | --- |
| `고전 명제 논리의 위치` | `claim` | learner-private provisional, model-generated | `create`, `independentlyValidated: true` | no human review event; no document persisted |
| `명제 논리는 항상 고전 논리라는 오해` | `misconception` | learner-private provisional, model-generated | `create`, `independentlyValidated: true` | no human review event; no document persisted |
| `분류 기준의 차이: 대상 영역과 추론 원리` | `distinction` | learner-private provisional, model-generated | `create`, `independentlyValidated: true` | no human review event; no document persisted |

The kinds themselves are legal and meaningful; not every knowledge unit is a
concept. The defect is that answer-outline artifacts were admitted as stable
knowledge identities. The titles describe rhetorical jobs or contextual headings
(`position`, `misunderstanding`, `difference in criteria`) rather than durable,
reusable endpoints. Resolution marked all three as independently validated in the
same model pass that chose `create`; that flag is model self-attestation, not an
independent semantic reviewer or human review event. The universal document rule
then required one definition block for every kind, forcing claim, misconception,
and distinction records into concept-shaped source documents.

## Typed admission and document contract

Do not blacklist these Korean titles, delete the records, or auto-merge them into
the two concept nodes. Preserve their provenance and review history.

1. Extraction now emits typed artifacts before admission: definitions, claims,
   distinctions,
   answer-material requests, misconceptions-to-correct, and outline/rhetorical
   nodes. Only durable identities enter ordinary knowledge reuse automatically.
2. Named endpoint requirements are enforced by kind. A distinction identifies both
   compared revision IDs; a misconception must identify the mistaken proposition
   and corrective revision; a claim must identify its subject/relation or evidence
   scope. A heading with no stable endpoints remains answer material.
3. Kind-specific primary documents replace the universal definition template.
   Concepts and term senses require a definition block, claims require a claim
   block, and distinctions require a contrast block. Legacy claim, procedure,
   skill, and misconception-shaped knowledge rows retain their existing readable
   definition documents; only newly typed contracts use the new primary blocks.
4. Separate stable identity from answer outline. Planning may create headings and
   transitions for the current answer, but those should remain document blocks
   attached to stable revisions unless a later semantic admission step establishes
   an independently reusable identity.
5. The generic `independentlyValidated` flag is removed. Every admitted artifact
   records a `resolution-stage model review` under rubric `typed-admission-v1`
   with all kind-specific checks true. Human review status remains separate.

Misconceptions now use separate identities, immutable revisions, blocks, exact
definition-revision links with specific learning-value explanations, and review
events. They are labeled potential general learning risks, never learner diagnoses,
and stale or ineligible definition links exclude them from future tutor context.
