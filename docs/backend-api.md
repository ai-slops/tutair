# Tutor API contract (Phase 1)

All JSON routes are under `/api`. Authentication is an opaque `tutor_session`
HttpOnly, SameSite=Strict cookie issued by `POST /api/auth/local-signup`.
Clients never send learner IDs. Error bodies are
`{ "error": { "code": string, "message": string } }`.

## Session and capabilities

- `POST /api/auth/local-signup` `{ displayName?: string }` -> `201 { learner, synthetic: false }`
- `GET /api/session` -> `{ learner }`
- `GET /api/capabilities` -> `{ provider, model, generation, embedding, search, synthetic, chatgpt }`

OpenAI providers also report `outputMode: "strict" | "compatibility" | "responses"`. The mode
is explicitly configured on the server, never silently selected after a failure.

When personal mode is enabled, all ChatGPT routes require the learner cookie:

- `GET /api/chatgpt/status` -> learner-scoped connection metadata without tokens
- `GET /api/chatgpt/connect` -> `302` to official authorization; loopback only
- `POST /api/chatgpt/manual/authorize` -> `302` to official authorization; enabled and exact-origin allowlisted only
- `POST /api/chatgpt/manual/callback` `{ callbackUrl }` -> learner-scoped connection metadata after exact loopback callback, state, PKCE, identity, and scope validation
- `GET /auth/callback` -> validates and stores the official callback grant
- `GET /api/chatgpt/models` -> `{ models: [{ slug, displayName }] }`, list-visible only
- `PUT /api/chatgpt/model` `{ slug }` -> `204` after account-catalog validation
- `DELETE /api/chatgpt/connection` -> `204` and removes this learner's local grant

The callback is outside `/api` because it is the OAuth redirect URI. Its random
state binds it to the initiating learner; callback output contains no credentials.
The manual endpoints are an optional Tutair relay, not an alternate redirect URI.
They require the same learner session and same-origin POST boundary. A second
learner receives the same invalid-state response and cannot consume or invalidate
the initiating learner's attempt.

## Conversations and messages

- `GET /api/conversations` -> `{ conversations: Conversation[] }`
- `POST /api/conversations` `{ title?: string, goal?: string }` -> `201 { conversation }`
- `GET /api/conversations/:id` -> `{ conversation, messages, threads }`
- `POST /api/conversations/:id/messages` `{ content: string }` -> `201 { message }`
- `PATCH /api/conversations/:id/messages/:messageId` `{ content: string }` -> `{ message }`
- `DELETE /api/conversations/:id/messages/:messageId` -> `204`
- `POST /api/conversations/:id/tutor-turn` `{ content: string, requestId?: UUID, assistance?: "none"|"hint"|"worked_example", confidence?: number, selfReport?: "unsure"|"neutral"|"confident" }` -> `201 { requestId, userMessage, tutorMessage?, run, thread?, knowledgeChanges, synthetic }`. Input is persisted even when generation fails. Reusing the same `requestId` and base input resumes or returns the stored request rather than creating a second learner message; conflicting reuse is rejected.

Messages retain immutable edit events; deletion is a tombstone.

Turn `run.exposureTrackingSkipped` is true when a model supplied exposure
annotations that could not be grounded in its final text. The reply is retained,
only verified exposures are stored, and `exposure_grounding_skipped` traces link
the discarded declarations to their original model run. This never creates
learner mastery evidence.

New exposure records are pinned to the immutable knowledge revision supplied to
final generation and the tutor message's original `created` event, even if the
definition changes during generation, output repair, or final review.

Tutor-turn requests additionally accept `threadId`, `newThread`, `origin`, `whyNow`,
and `desiredOutcome`. `threadId` and `newThread: true` are mutually exclusive.
The metadata initializes a new thread, rather than rewriting an existing project's
durable outcome. The current thread is retained unless explicitly overridden.
Without one, an exact-title retrieved match can be selected; ambiguous candidates
return 409 `thread_selection_ambiguous` with JSON-encoded `error.details.candidateIds`.
Use the returned `requestId` with an explicit `threadId` or `newThread: true` to
resolve that choice. The accepted learner message remains saved and is not posted
again. A request still running can be continued with the same ID; unknown delivery
is checked before retry, while a confirmed failed request is refreshed rather than
blindly resubmitted.

Turn `run.evaluationSkipped` distinguishes a successful empty evaluation from a
failed or persistently invalid evaluation. `run.followupTrackingSkipped` identifies
a suggested follow-up that did not reference offered knowledge. Evaluator output
also supports `unresolvedAmbiguities` and nullable `suggestedFollowup` with
`knowledgeUnitId`, `dimension`, and method. Accepted proposals become pending thread
questions, not automatic quizzes or mastery. `evaluation_outcome` traces preserve
the decision. Evidence observations must match supplied revision/thread/assessment
references and source-span bounds; no observations from a rejected batch are saved.

## Threads

- `GET /api/threads` -> `{ threads: Thread[] }`
- `POST /api/threads` `{ title, goal, conversationId?: string }` -> `201 { thread }`
- `GET /api/threads/:id` -> `{ thread, events, openQuestions, conversations }`. Thread IDs and conversation IDs are different. Resume a thread through its resume endpoint, not the conversation lookup endpoint.
- `PATCH /api/threads/:id` `{ title?: string, goal?: string, status?: "open"|"paused"|"resolved" }` -> `{ thread }`
- `POST /api/threads/:id/resume` `{ conversationId?: string }` -> `{ thread, conversation }`

Create/update also support `origin: question|project|problem|resource|curriculum|recommendation`,
nullable `whyNow`, `desiredOutcome`, `targetKnowledgeUnitIds`, and
`deferredKnowledgeUnitIds`. Create requires either `goal` or `desiredOutcome`.
`goal` is the current objective; `desiredOutcome` remains the durable outcome.
Unit references must be learner-owned or canonical; targets are removed from
deferred units when promoted. Planner references are restricted to offered units.

Status inputs also accept `abandoned`, `active` (alias for `open`), and `parked`
(alias for `paused`). Responses retain `open|paused|resolved|abandoned` for existing
clients. Paused/resolved/abandoned threads stop being current; ordinary turns do
not reopen them. Use the explicit resume endpoint to reactivate one.

- `POST /api/threads/:id/questions` `{ text }` -> `201 { question }`
- `PATCH /api/threads/:id/questions/:questionId` `{ status: "open"|"resolved"|"parked" }` -> `{ question }`

New questions are deduplicated by trimmed case-insensitive text; legacy duplicate
rows are not deleted during migration. Thread detail adds `questionEvents`.
The historical `openQuestions` response key contains all question statuses; normal
tutor context includes bounded open/parked questions, not resolved ones. Thread
metadata updates preserve before/after snapshots in the event history.

## Knowledge and evidence

- `GET /api/knowledge?scope=canonical|provisional|all` -> `{ items: KnowledgeItem[] }`
- `GET /api/knowledge/:id` -> `{ item, revisions, relations, evidence, exposures, learnerState }`
- `GET /api/knowledge/:id/revisions/:revision` -> `{ revision, evidence, learnerState }`
- `POST /api/knowledge` `{ title, statement, scope?: "provisional", riskScope?: RiskScope, confidence?: number }` -> `201 { item, revision }`
- `POST /api/knowledge/import` `{ format: "yaml", content: string }` -> `201 { imported }`. Requires both a learner session and the `x-tutair-canonical-token` header matching server-side `TUTOR_CANONICAL_IMPORT_TOKEN`. Imports are disabled without an operator token. Generated model output is rejected.
- `GET /api/evidence?knowledgeId?=&revision?=` -> `{ evidence: Evidence[] }`
- `POST /api/evidence` `{ knowledgeId, revision, messageId, polarity: "positive"|"negative", strength?: number, assistance?: "none"|"hint"|"worked_example", confidence?: number, ambiguous?: boolean }` -> `201 { evidence }`
- `POST /api/evidence/rebuild` `{ knowledgeId?: string }` -> `{ rebuilt }`
- `POST /api/corrections` `{ knowledgeId, revision, statement, reason, messageId?, kind?: "revise"|"claim_more"|"claim_less"|"invalidate_evidence"|"meaning_mismatch", evidenceIds?: string[], targetType?: "knowledge"|"revision"|"evidence"|"meaning", targetId?: string }` -> `201 { correction, item, revision }`

RiskScope is `stable | definition-sensitive | current-contested | high-stakes`.
Evidence projections use learner messages only. Exposures are stored separately and
never count as evidence. Evidence is pinned to an exact immutable revision.
Each learner-state dimension includes `knowledgeRevisionId`, `evidenceIds`, and
`projectionVersion`, making the projection inputs and algorithm version inspectable.
Rebuild reconstructs every revision of the selected unit, or every visible unit
when `knowledgeId` is omitted, using only the authenticated learner's records.
`rebuilt` counts knowledge units, not revisions or dimension rows. Historical
results are available at `/api/knowledge/:id/revisions/:revision`; the unit detail
and tutor context use current-revision state. Old evidence is never automatically
transferred to a new revision, and later invalidations also update historical state.
Only `revise` creates a definition revision. `claim_more`, `claim_less`, and
`invalidate_evidence` remain on the selected revision. A `meaning_mismatch` creates
a distinct provisional unit while retaining the original unit and its evidence.
Every correction reference is validated against the authenticated learner, unit,
and exact revision before the correction is written; the entire mutation and
projection rebuild commit or roll back together.

## Knowledge metadata

Knowledge create and canonical YAML import additionally accept `definitionScope`
with optional `domain`, `context`, `audienceLevel`, `inclusions`, and `exclusions`.
The existing `semanticScope` string is retained. Claims may be legacy strings or
`{ text, authority, sourceRefs, status? }`, where status is
`model_generated|source_supported|reviewed`. Labels are provenance metadata, not
automatic fact verification. Model-generated claims cannot self-promote; absent
historical statuses are not fabricated. Canonical reimport and semantic reuse
reject incompatible structured scopes. A `revise` correction preserves prior
definition metadata; meaning mismatch creates a distinct unit with unknown state.

Relation necessity accepts `hard|soft|contextual|recommended`, existing
`required|helpful|optional`, or a number in `[0,1]`; legacy values are not guessed
into a different meaning.

## Exposure provenance

Knowledge-detail and export exposure records include `knowledgeRevisionId`,
`messageEventId`, and `provenance`, in addition to the existing unit, numeric
revision, message, owner, and timestamp fields. New records use
`provenance: "generation_snapshot"` and have non-null revision/event IDs.
The source event and definition can be inspected in the private export's
`messageEvents` and `revisions`. Message edits and tombstones do not retarget them.
Knowledge detail includes exposures from all revisions; filter by `revision`
when inspecting one definition. The revision endpoint's response is unchanged.

Startup-migrated records use `provenance: "legacy_unverified"`. Their stored
unit/revision pair is mapped to a UUID only when an owned or canonical revision
exists. Missing revision IDs remain null; `messageEventId` stays null because
historical generation provenance cannot be reconstructed reliably. Such rows are
retained, never silently certified or retargeted on a later startup. Only records
with a matching exact revision UUID contribute exposure to a rebuilt projection.
Legacy exposure with a resolved UUID still means exposure, not mastery.

New inserts require matching revision/unit/owner and tutor message/event references.
Exposure history cannot be updated, replaced, or normally deleted. Explicit learner
privacy erasure still removes private exposures, including exposures to canonical
knowledge, without deleting shared canonical definitions.

## Search and privacy

- `GET /api/search?q=...&limit?=...` -> `{ results, mode: "hybrid"|"fts-only" }`
- `GET /api/export` -> `{ exportedAt, projectionVersion, learner, conversations, messages, threads, knowledge, revisions, evidence, exposures, learnerState, corrections, modelRuns, traces }`
- `DELETE /api/privacy` -> `204`, clears learner-owned rows and session cookie.

Common records use UUID `id` and ISO `createdAt` fields. Knowledge records include
`scope`, `riskScope`, `currentRevision`, and projected `mastery`/`confidence`.

Use `learnerState` for educational decisions, not the legacy aggregate fields on
the knowledge row. State is revision-specific and has six separate dimensions.

## Complete evidence input

The compact input above is convenient for manual observations. The full boundary
also accepts `knowledgeRevisionId`, `conversationId`, `messageEventId`,
`assessmentId`, `dimension`, `evidenceType`, `score`, `evaluatorConfidence`,
`evaluator: { type, modelRunId?, rubricVersion }`, `supportingSpans`, `limitations`,
`relatedUnitIds`, `threadId`, `difficulty`, and `contextDiscount`.

Detailed `assistance` is `{ hints, answerVisible, openBook,
copiedFromRecentContext }`. Spans are `{ start, end }` character offsets into the
assessed source snapshot. The runtime resolves and validates exact revision and
message-event references before writing. A source snapshot remains attached to
the evidence when a later message edit changes the displayed conversation.

Every supplied private reference must belong to the current learner. Evidence
may reference only learner messages. Invalid references do not partially mutate
state. Model observations are associated with their evaluation model run.

## External execution evidence

`POST /api/evidence` additionally accepts evaluator
`{ type: "test_runner", rubricVersion, runner, suiteRef, resultRef? }`.
The response/export includes `evaluatorMetadata`. This records an externally
obtained execution result; it does not execute arbitrary code on the server.

## Model context snapshots

Private exports add `modelRunContexts`, `currentThreads`, and `threadQuestionEvents`.
Each context contains the exact bounded `StructuredCall` envelope dispatched to
the provider adapter: stage/version, system instructions, data (including state
and revision references), and JSON schema, plus `contextVersion` and `contextHash`.
Snapshots include failed attempts and repair attempts and are immutable. They
contain private learner data, never credentials or requested internal reasoning.
Privacy erasure removes them. Historical runs without a snapshot remain without
one; do not reconstruct their input from current learner state.

The context hash is SHA-256 of recursively key-sorted JSON using
`model-context-version.ts`; `inputHash` in run details remains the hash of bounded
data. This permits inspecting/replaying the adapter input, not reproducing a
stochastic model response or the provider's private internals. Output schema
versions advance per stage, without rewriting earlier run versions.

## Quality labels and evaluation

- `POST /api/quality/observations` `{ messageId, metric, value, prediction?, note? }`
- `GET /api/quality/observations`
- `GET /api/quality?includeSynthetic=false`

Metrics are `extraction_correct`, `provisional_duplicate`, `incorrect_merge`,
`evaluator_agreement`, `unnecessary_diagnostic`, `missed_prerequisite`,
`answer_abandoned`, `predicted_correctness`, and `contradictory_evidence`.
Values are in `[0, 1]`. Prediction labels require a probability and a binary
observed outcome. Reports include sample counts, means, Brier score when labeled
predictions exist, and correction counts. Unmeasured rates are `null`, not perfect
scores. Synthetic observations are excluded by default. These are manually
labeled measurements, not claims of automatic educational calibration.

## Errors and operational limits

Validation errors use 422; unauthenticated requests use 401; unauthorized
canonical imports use 403; unavailable records use 404; conflicting or concurrent
turns use 409; request bodies over 1 MiB use 413. Tutor requests are rate-limited.
Model failures preserve the accepted learner message and return its ID in error
details. Refresh the conversation before retrying to avoid duplicate submissions.
Conversation deletion is refused when it would destroy learning provenance; use
the explicit learner privacy-erasure endpoint for permanent deletion.
