# Phase 1 acceptance contract

The [numbered requirements](phase-one-specification.md) preserve the supplied
Phase 1 design in condensed form. The [implementation status](phase-one-status.md)
maps each section to code, validation evidence, and remaining work. This contract
defines required behavior; it is not a claim that all requirements are complete.

Tutair is a local-first learning runtime, not a prebuilt curriculum and not a
canonical encyclopedia. It must support a new topic with zero canonical rows.
The learner's current question or project is the starting point.

## Non-negotiable invariants

1. Tutor statements create exposure, never learner mastery evidence.
   New exposures identify the generation-time immutable knowledge revision and
   original tutor message event. Legacy provenance remains explicitly unverified.
2. Every evidence record identifies the exact immutable knowledge revision
   evaluated, plus its source learner message and evaluation provenance.
3. Model-generated knowledge remains provisional. Uncertain semantic equivalence
   creates a duplicate rather than silently merging different meanings.
4. Learner state is a versioned, reproducible projection of evidence, exposures,
   and recorded learner corrections. It is never an independent source of truth.
   Rebuilding includes historical revisions without transferring their evidence
   to the current definition; tutor context uses current-revision state.
5. Unknown prerequisites do not automatically block the current goal.
6. Original messages and edit events are preserved. Search indexes, summaries,
   embeddings, and learner projections are disposable derived data.
7. Private records and provisional knowledge are learner-local. Every read,
   search, model context, mutation, export, and erasure is authorization-scoped.

Privacy erasure is an explicit exception to preservation. It must invalidate
derived records as well as source content. Deleting a normal message instead
creates a tombstone and preserves its history.

Exposure records reject ordinary updates, deletions, and replacement writes.
Legacy migration preserves source rows and never invents missing message events
or promotes historical exposure to a verified generation snapshot.

## Knowledge and provenance

A knowledge unit has a stable identity, authority (`canonical` or `provisional`),
label, aliases, kind, and current revision pointer. Kinds are `term_sense`,
`concept`, `claim`, `procedure`, `skill`, `distinction`, and `misconception`.

A revision records a definition, semantic scope, distinguishing features,
claims and their authority, source references, timestamp, and origin. LLM origins
identify the model run, conversation, and source messages. A changed definition
creates a new revision. Old evidence is not automatically carried forward.

Relations identify endpoints and supporting revisions. Supported relation types
are prerequisite, subtype, part, entailment, contrast, common confusion, example,
and relatedness. A prerequisite records necessity and whether scaffolding can
temporarily substitute for understanding it.

Resolution searches canonical exact matches, canonical semantic candidates, and
compatible learner-local provisional candidates. An independent structured model
judgment records the decision and reason codes. Embedding proximity is a candidate
signal, not an identity guarantee.

## Evidence and state

The six independent dimensions are recognition, recall, explanation,
application, discrimination, and transfer. Each projected dimension records
estimate, uncertainty, status, effective evidence, and last observation.
Statuses are unknown, exposed, tentative, supported, and stale.

Evidence records include:

- Unit and revision identity; learner, conversation, message, and optional assessment.
- Dimension, score, polarity, evaluator confidence, evaluator/run/rubric version.
- Evidence type: self-report, recognition response, free explanation, application,
  contrast, prediction, artifact, or execution result.
- Assistance: hint count, visible answer, open book, and recent-context copying.
- Supporting message spans, limitations, related units, thread, and difficulty.

The initial algorithm is weighted aggregation, not a calibrated probability:

```text
weight = evidenceTypeWeight * evaluatorConfidence
       * assistanceDiscount * copyingDiscount * contextDiscount
positive = sum(weight * score)
negative = sum(weight * (1 - score))
estimate = (priorPositive + positive)
         / (priorPositive + priorNegative + positive + negative)
```

Self-report is weak; unsupported ambiguous statements contribute little.
Copied tutor wording is strongly discounted. Familiar application never raises
formal explanation or transfer without separate evidence. Exposure alone has
zero mastery weight.

Learner corrections distinguish claiming more knowledge, claiming less knowledge,
invalidating evidence, and meaning mismatch. Invalidated evidence must cease
contributing after projection rebuild without deleting the original observation.

## Turn pipeline

1. Persist the learner message before calling any model.
2. Resolve the active thread and current goal. A thread may span conversations.
3. Retrieve bounded recent context, relevant old messages, thread questions,
   knowledge, prerequisite relations, state, and supporting evidence.
4. Evaluate applicable learner evidence independently of response generation.
5. Extract only the required micrograph and resolve each candidate.
6. Plan intent, goal, target/assumed/introduced/deferred units, natural assessment
   opportunities, response strategy, and whether interruption is justified.
7. Generate a response draft.
8. Lint the actual concepts in the draft. For each important concept record
   centrality, learner uncertainty, misunderstanding cost, and one of allow,
   simplify, define inline, give example, diagnose, or defer.
9. Resolve any important new concept discovered by linting and revise the answer.
10. Store the tutor reply and only the exposures actually explained in it.
11. Persist traces, update the thread and projections, and index derived documents.

Extraction, resolution, planning, draft/final generation, linting, and evaluation
are independent versioned structured calls. Model runs preserve provider/model,
purpose, prompt/schema versions, input hash, structured output, usage, latency,
and failure/fallback status. Do not request or store private chain-of-thought.

Generation inspection preserves exact persisted attempts. A request resolves to
one saved learner message, and only model runs correlated to that message may be
listed. Summary reads are cheap; bounded call/output/trace detail is lazy,
authenticated, owner-scoped, and recursively redacted. Polling observes state and
must never create another message or model run. Failed attempts and schema repairs
remain separate and linked. Missing historical model, usage, timing, or snapshots
remain null/Unknown and are never reconstructed or converted to zero.

Extraction failure permits an explicitly untracked general answer. Linter failure
permits an answer marked `lintSkipped`. Model service unavailability is not an
excuse to pretend a scripted response came from a real model.

## Search, risk, and operation

Hybrid retrieval combines full-text and actual semantic embeddings over messages,
threads, knowledge, and evidence. Unit IDs expand relevant queries. Authorization
is applied before scoring and snippets. Embedding model profiles are versioned;
incompatible vectors are never compared. Retrieval reports hybrid or explicitly
degraded lexical-only mode.

Stable knowledge permits provisional tutoring. Definition-sensitive topics retain
scope. Current or contested facts remain uncertain without external verification.
High-stakes material is not automatically canonicalized. Knowledge content is
quoted data, never system policy.

All generated data, model decisions, exposures, corrections, thread history, and
source links must remain available for later Phase 2 re-evaluation. Automatic
canonicalization, clustering, editorial workflows, personal KB, gamification,
notifications, and sophisticated spaced repetition are out of scope.

## Required acceptance scenarios

| Scenario | Observable result |
| --- | --- |
| Empty canonical database | A new question creates provisional micrograph, plan, reply, and exposures. |
| Exposure is not knowledge | A tutor explanation creates no learner evidence or explanation mastery. |
| Different senses | Ceremonial formal and formally specified remain distinct units. |
| Important unknown premise | The linter detects formal terminology and scaffolds or diagnoses it. |
| Peripheral unknown terms | The learner is not forced through a diagnostic for every term. |
| Copied explanation | A near-repeat of recent tutor wording is identified and heavily discounted. |
| Voluntary explanation | A meaningful learner explanation can create evidence without a quiz. |
| Real application | FSM/state/transition application does not imply formal-system explanation. |
| Return to a topic | Relevant threads, evidence and state are retrieved without dumping all history. |
| Revised definition | New revision is created; past evidence still references the old revision. |

Additional boundary checks cover cross-learner isolation, session authentication,
privacy erasure, source edits, interrupted calls, projection rebuild determinism,
unsupported claims, provider schema violations, and safe concurrent turns.
