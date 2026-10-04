# Learner model and resolution policy

## Evidence before state

Six dimensions are projected independently: recognition, recall, explanation,
application, discrimination, and transfer. The prior estimate is 0.5 with maximum
uncertainty and status `unknown`; it is not a claim of 50% mastery. Exposure gives
recognition status `exposed` and contributes zero effective evidence.

The projection uses prior positive and negative weights of 1 each. Evidence-type
weights are 0.2 for self-report, 0.4 for recognition, 0.8 for free explanation and
prediction, 0.9 for contrast, and 1 for application, artifacts, and execution
results. Transfer observations receive a 1.2 multiplier.

Additional multipliers are evaluator confidence, a recorded context discount,
0.1 for copied recent wording, 0.05 for ambiguity, 0.25 for a visible answer, and
0.7 for open-book help. Hint assistance is divided by `1 + hints * 0.5`.

Positive and negative totals accumulate weighted score and weighted `(1-score)`.
The estimate is `(1 + positive) / (2 + positive + negative)`. Uncertainty starts
from `1 / (1 + effectiveEvidence)`. A supported dimension requires at least 1.2
effective evidence and estimate 0.65; weaker observations remain tentative.
Observations older than 90 days are marked stale, not erased.

The algorithm version is `weighted-revision-dimensions-v2-risk`. Provisional
current-contested and high-stakes knowledge cannot become `supported`; its
uncertainty is at least 0.6 until an independently trusted authority is available.
No amount of repeated unverified model evaluation removes this restriction.

These values are transparent product heuristics, not calibrated psychometric
probabilities. The quality-label API supports later empirical validation.

## Revisions and corrections

Evidence references a revision UUID and sequence number, a learner message and
immutable message event, the assessed source snapshot, supporting character spans,
and evaluator provenance. A revised definition does not inherit old evidence.
Exports retain both source and derived records.

New exposures retain the final-generation knowledge revision and the original
tutor message event. A revision change while generation, schema repair, or final
review is in progress does not move that exposure to the newer definition.
Exposures are immutable and learner-local; only privacy erasure removes them.
Legacy exposures are marked `legacy_unverified`, with no inferred source event.
Rebuild uses exact stored revision UUIDs, including the UUIDs recovered from valid
legacy unit/revision pairs. An unresolved legacy revision never gains exposure
merely because a matching sequence number is created later.

Projection rebuilds reconstruct all immutable revisions of each selected unit,
including historical evidence, exposures, and subsequent invalidations or
corrections. Current unit aggregates and tutor context use only current-revision
state. Historical state remains inspectable through the revision API and does not
become evidence for a newer definition. This is recalculation with the current
algorithm and clock, not an as-of-time replay; staleness can change with time.

Invalidated observations remain in the archive but stop contributing to state.
Claiming less knowledge raises uncertainty and removes supported status where
appropriate. Claiming more knowledge weakly reduces recognition uncertainty by
at most 0.05 for 90 days, but never changes the estimate, status, or effective
evidence on its own. Repeated claims do not accumulate this adjustment. It does
not invent a mastery observation or an evidence ID.
Neither operation rewrites the knowledge definition. Meaning mismatch creates a
distinct provisional unit; definition editing creates a new immutable revision.

Correction references are ownership- and revision-checked before a transaction.
Creation, invalidation, and projection changes either commit together or roll
back together. Privacy erasure is the explicit exception to immutable history.

## Conservative identity resolution

Canonical exact-label and alias candidates precede canonical semantic candidates,
then learner-local provisional knowledge. Search is a candidate finder, never an
identity oracle. A model must make a separate structured equivalence judgment.

Automatic reuse requires an offered exact revision, the same knowledge kind,
compatible normalized scope, and equivalence confidence of at least **0.9**.
This threshold is defined in `src/server/resolution-policy.ts`.

Low-confidence, missing, conflicting, or unoffered bindings become provisional
duplicates from the original extracted candidate. The resolver cannot silently
rewrite that candidate's definition or add unrequested units. Applied decisions,
ignored keys, and reason codes are traced alongside the original model output.
Different definitions sharing an extraction key fail structured validation rather
than being destructively merged.

## Retrieval and model boundaries

The runtime indexes authorized messages, threads, knowledge, and evidence using
SQLite FTS5 and combines lexical and semantic ranks with reciprocal-rank fusion.
Thread search also includes the durable desired outcome and why-now metadata.
The query-local FTS index deliberately excludes other learners from BM25 corpus
statistics and is discarded immediately after ranking. This favors simple,
private local operation over large-corpus indexing throughput.

Semantic vectors are cached by owner, source identity, source-content hash, and
embedding profile. Empty, non-finite, or dimension-mismatched vectors trigger an
explicit lexical-only fallback. The local MiniLM profile uses a pinned revision,
quantized CPU inference, mean pooling, L2 normalization, and 384 dimensions.

Model context is bounded by relevance, count, and text budgets. It includes
selected definitions, one-hop relationships, revision-specific state, evidence,
recent messages, and thread questions. New evidence is projected before planning.
An additional final-answer lint protects high-risk output. Exposures require
approved unit IDs and non-empty spans in the final reply.

Post-resolution context now refreshes definitions, revision-scoped state and
relations before planning, draft, and lint. Retrieved units remain available to
final generation alongside lint-discovered units. Safety lint receives the whole
draft, or the call explicitly fails its budget check; a truncated tail is not
silently treated as inspected.

Evaluation validates observations against the exact revisions offered for that
call, supplied assessments, the selected thread, related-unit IDs, and UTF-16
span bounds in the original learner message. A source edit during the model call
does not retarget evidence to the edited event. Invalid batches are regenerated
once and otherwise skipped with an explicit flag; evidence and the accepted
evaluation outcome are persisted atomically. A structured follow-up is a pending
learning question, not a mastery observation or a mandatory quiz.

The bounded model input envelope is preserved in immutable learner-private
`model_run_contexts`. Its revision/state references and schema versions explain
the inference inputs; this is not a guarantee of deterministic model output or
educational calibration. See [real quality evaluation](quality-evaluation.md).
