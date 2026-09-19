# Tutor API contract (Phase 1)

All JSON routes are under `/api`. Authentication is an opaque `tutor_session`
HttpOnly, SameSite=Strict cookie issued by `POST /api/auth/local-signup`.
Clients never send learner IDs. Error bodies are
`{ "error": { "code": string, "message": string } }`.

## Session and capabilities

- `POST /api/auth/local-signup` `{ displayName?: string }` -> `201 { learner, synthetic: false }`
- `GET /api/session` -> `{ learner }`
- `GET /api/capabilities` -> `{ provider, model, generation, embedding, search, synthetic }`

## Conversations and messages

- `GET /api/conversations` -> `{ conversations: Conversation[] }`
- `POST /api/conversations` `{ title?: string, goal?: string }` -> `201 { conversation }`
- `GET /api/conversations/:id` -> `{ conversation, messages, threads }`
- `POST /api/conversations/:id/messages` `{ content: string }` -> `201 { message }`
- `PATCH /api/conversations/:id/messages/:messageId` `{ content: string }` -> `{ message }`
- `DELETE /api/conversations/:id/messages/:messageId` -> `204`
- `POST /api/conversations/:id/tutor-turn` `{ content: string, assistance?: "none"|"hint"|"worked_example", confidence?: number, selfReport?: "unsure"|"neutral"|"confident" }` -> `201 { userMessage, tutorMessage?, run, thread?, knowledgeChanges, synthetic }`. Input is persisted even when generation fails.

Messages retain immutable edit events; deletion is a tombstone.

## Threads

- `GET /api/threads` -> `{ threads: Thread[] }`
- `POST /api/threads` `{ title, goal, conversationId?: string }` -> `201 { thread }`
- `GET /api/threads/:id` -> `{ thread, events, openQuestions, conversations }`. Thread IDs and conversation IDs are different. Resume a thread through its resume endpoint, not the conversation lookup endpoint.
- `PATCH /api/threads/:id` `{ title?: string, goal?: string, status?: "open"|"paused"|"resolved" }` -> `{ thread }`
- `POST /api/threads/:id/resume` `{ conversationId?: string }` -> `{ thread, conversation }`

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
Only `revise` creates a definition revision. `claim_more`, `claim_less`, and
`invalidate_evidence` remain on the selected revision. A `meaning_mismatch` creates
a distinct provisional unit while retaining the original unit and its evidence.
Every correction reference is validated against the authenticated learner, unit,
and exact revision before the correction is written; the entire mutation and
projection rebuild commit or roll back together.

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

## Quality labels

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
