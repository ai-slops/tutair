# Phase 1 verification record

This is a chronological record, not a claim that every original requirement is
complete. See the [requirement audit](phase-one-status.md) for remaining work.
The latest verification is October 11, 2026, below; earlier observations are
retained with their original dates and environment limitations.

## Baseline: September 19, 2026

Verified using Node.js 24 in the provided DIM workspace.

## Automated checks

`TEST_LOCAL_EMBEDDINGS=1 npm run verify` completed successfully:

- TypeScript strict type checking passed.
- Biome returned zero errors. Five CSS warnings remain: four deliberate
  reduced-motion `!important` overrides and one disabled-control specificity
  warning. The browser review verified the resulting accessible states.
- 92 tests passed across 24 test files, including real pinned local-model
  inference. No tests were skipped in this run.
- Server compilation and production browser build passed.
- Production dependency audit reported zero vulnerabilities.

The TypeScript language server is not installed in this environment. Compiler
checks were used; an LSP-clean result is not claimed. Vite reports two harmless
upstream Zod annotation warnings while removing those comments from its bundle.

## Real HTTP use

The application was launched through the actual `node app/server.mjs` DIM
entrypoint. A separate authenticated HTTP driver exercised:

1. Zero canonical units and a new FSM question.
2. Six generated provisional units, persisted model runs, and a tutor reply.
3. First-reply exposure with recognition `exposed`, no learner evidence, and zero
   explanation effective evidence.
4. Independent learner explanation, without raising unrelated dimensions.
5. Copied recent tutor wording and its evidence discount.
6. Actual local-embedding plus FTS5 retrieval returning `hybrid`.
7. Thread resumption into another conversation while preserving the original link.
8. A lower-knowledge correction without changing the definition revision.
9. Cross-learner record access returning 404.
10. Privacy erasure revoking sessions and removing private records.

The driver observed six message events and 24 model runs for three complete demo
turns, then erased only its own test learners. A separate real HTTP run imported
`examples/fsm.yaml` using the operator token and verified two canonical units and
one revision-linked relationship.

## Browser use

Playwright drove a real Chromium instance, using temporary user-local runtime
libraries because the container lacks system browser packages. Tested viewports
were 1280, 768, and 375 pixels.

Verified workflows include private-session setup, FSM conversation, learner
explanation/application, current-revision state and provenance inspection,
hybrid search, actual thread-result navigation, corrections, reload, settings,
model configuration help, export, and privacy confirmation. The authenticated
workflow produced no browser console errors or warnings. Independent visual
review passed with no remaining product or screenshot-evidence blockers.

## Explicit limitations

- No real LLM API credential was supplied. The OpenAI-compatible adapter was
  verified against a real HTTP test server enforcing structured schemas, but a
  paid or externally authenticated model call was not performed.
- Demo responses are scripted and visibly synthetic. They verify the runtime,
  not general tutoring quality or model accuracy.
- Local MiniLM inference was verified. Its English-first semantic behavior is
  not a claim of equivalent retrieval quality in every language.
- Statistical educational quality requires manually labeled observations and
  longitudinal data. Unmeasured metrics remain unavailable.
- The managed Git remote cannot resolve `dim-gitea` from this nested container.
  Push requires the operator's documented DIM `hostAliases` injection.
- At the final environment check, DIM external-URL discovery returned 500 and
  the configured HTTPS ingress returned 502, while the local application health
  and HTTP acceptance flow worked. Public ingress availability is not claimed.

The original `.dim` files were not changed. Environment networking repair is
separate from application correctness; see `docs/operations.md`.

## Compatibility verification: September 20, 2026

After credentials were supplied, the configured `claude-haiku-4` endpoint was
tested directly. It accepted streaming chat completions but rejected
non-streaming requests, JSON response formats, and forced tool calls. Explicit
`TUTOR_OPENAI_MODE=compatibility` support was added without changing strict mode.

Two consecutive real API-backed tutor turns, a Korean FSM question and a learner
explanation, returned HTTP 201 in an isolated learning session. The session
recorded 31 provisional units, four verified exposures, and five learner evidence
records. Invalid schema enums were regenerated once; failed attempts remained in
the model-run history. These counts demonstrate persistence, not extraction
precision or calibrated educational quality. The two turns took approximately
262 seconds combined, so browser tutor submissions now have a five-minute limit.

Live testing also found inaccurate model-generated source offsets. Final output
can now supply a verbatim quote, which the server locates itself. Invalid or
ambiguous exposure annotations are excluded with an audit trace and an explicit
tracking-skipped flag; raw model output is retained. No learner evidence is
invented to compensate for missing annotations.

The deployed HTTPS interface was also exercised in Chromium with a fresh QA
session. A Korean FSM question completed with HTTP 201 after approximately
100 seconds and its answer appeared in the conversation, confirming that the
longer browser submission timeout is active. QA used isolated test learners;
existing learner conversations and API credentials were not modified.

## Requirement audit and revision reconstruction: September 22, 2026

Compared the supplied 0–69 section specification with documentation, source, and
tests. Added a numbered, condensed requirements preservation document and a
section-by-section implementation status/backlog. These are not a verbatim copy
of the original source file or a declaration of complete Phase 1 delivery.

Implemented reconstruction of historical learner-state revisions and explicit
current-revision selection in tutor context. A historical evidence invalidation
now updates its historical projection without deleting the original evidence or
transferring it to the new definition. Rebuild continues to count units.

Validation on Node.js 24.19.0:

- Before changes: 111 tests passed, one opt-in local-embedding test skipped.
- New regression coverage first demonstrated missing historical rows and stale
  historical state after evidence invalidation; the context test demonstrated
  selection of old state by projection timestamp rather than current revision.
- Final `npm test`: **116 passed, one skipped, 29 test files passed**.
  Five new scenarios are in `tests/server/projection-rebuild.test.ts`.
- `npm run typecheck`, `npm run check`, and `npm run build` passed.
  The same five CSS warnings and two upstream Zod annotation warnings remain.
- TypeScript LSP is still unavailable; Markdown has no configured LSP. Compiler
  and formatter checks were used instead. No LSP-clean result is claimed.

A separate driver started the built API on an ephemeral loopback HTTP port with
an isolated in-memory SQLite database and synthetic demo generation. It observed:

1. Health success, zero canonical units, and six provisional units from an FSM turn.
2. Tutor exposure with zero learner evidence, followed by a manually supplied
   application observation and a second immutable definition revision.
3. After discarding only this temporary learner's projection cache, the real
   rebuild endpoint restored six historical dimensions with recognition exposure
   and application effective evidence of 1.
4. Current revision 2 retained six unknown dimensions and aggregate mastery 0.
5. Invalidating the old observation removed its projection contribution while
   preserving the evidence row and historical recognition exposure.
6. A different learner's rebuild returned 404; a malformed unit ID returned 422.

The temporary HTTP listener and database were closed. Existing learner data and
credentials were not read or changed. This run did not exercise a real external
LLM, local-model inference, public ingress, or browser UI. The embedding integration
test is intentionally opt-in and was not enabled; existing September 19–20 results
are historical evidence, not claimed as rerun. No frontend code changed.

## Exposure snapshot and immutable history: September 22, 2026

Completed the next Phase 1 backlog item: pin new exposures to the exact knowledge
revision supplied to final generation and the original tutor message event. The
same snapshot now flows through final generation, schema repair, final review,
and persistence. Exposure insertion validates both reference chains; update,
ordinary delete, and SQLite replacement writes are blocked.

Startup migration preserves legacy rows, backfills only valid historical
unit/revision/owner mappings, and labels every pre-upgrade row `legacy_unverified`.
It does not infer message events or retroactively assert generation provenance.
Unresolved legacy references remain null and cannot start contributing exposure
when a matching revision sequence number is created later. Mixed old/new records
survive reopening; incomplete hand-modified schemas are rejected.

Validation:

- `npm test`: **133 passed, one skipped, 32 test files passed**.
  Seventeen new cases cover revision changes during generation/review/repair,
  original-event preservation after edits/tombstones, legacy migration/reopening,
  invalid revision and ownership links, immutable writes including replacement,
  and private/canonical exposure erasure without deleting shared definitions.
- Initial regression runs reproduced revision drift and missing source-event
  links, allowed history mutation/replacement, and unresolved legacy exposure
  incorrectly attaching to a subsequently created revision.
- Type checking, Biome checks, and server/client builds passed. After the final
  projection filter change, the full test suite, type check, affected-file Biome
  check, and server build were rerun. Client inputs did not change.
- Existing five CSS warnings and two upstream Zod annotation warnings remain.
  TypeScript LSP is unavailable and Markdown has no configured LSP; no LSP-clean
  claim is made. Changed source/test modules remain below 250 nonblank/noncomment
  lines; `tutor.ts` is at 249 and should be split by responsibility before further
  orchestration growth. No new type assertions, dependencies, or logging added.

A separate driver used the built API over a live ephemeral loopback HTTP listener
and an isolated temporary on-disk SQLite database. It seeded the old six-column
exposure format, then exercised the real application startup migration and HTTP
export/rebuild/turn/edit/tombstone/privacy endpoints. It observed:

1. Legacy records exported as `legacy_unverified`, with no fabricated event ID.
2. A legacy missing revision remained unknown after that sequence number was
   created and the learner projection was rebuilt.
3. A real correction request changed a knowledge unit to revision 2 while the
   synthetic provider's final call was pending. Its exposure remained on revision
   1 and the UUID supplied to generation. The turn stored five exposures and zero
   learner evidence; aggregate mastery remained zero.
4. Editing and tombstoning the tutor reply left the linked original event content
   equal to the generated reply. Direct exposure UPDATE/DELETE attempts failed.
5. Erasure succeeded for both the migrated learner and the new learner with HTTP
   204; the erased session returned 401 and SQLite reported zero FK violations.

The listener, database, and temporary database directory were closed/removed.
Existing learner data and credentials were not touched. Generation was explicitly
synthetic and embeddings disabled; external model quality, browser UI, public
ingress, and the opt-in local embedding integration were not retested.

## Remaining backend contracts and integration: September 22, 2026

Completed the actionable backend items from the remaining-work list:

- One refreshed post-resolution knowledge/state/relation context for planning,
  draft, initial lint, final generation and final review, preserving retrieved
  units and generation-time revisions. Safety inspection does not silently lose
  the tail of a long draft to the context budget.
- LearningThread origin, why-now, durable outcome, targets/deferred units,
  question lifecycle/audit, stable current selection, explicit new/select/resume,
  and legacy status compatibility. Existing duplicate questions survive migration.
- Explicit evaluation/follow-up skipped flags, structured ambiguity/follow-up,
  supplied revision/thread/assessment/related-unit/span validation, original
  learner-message event pinning, and atomic accepted evaluation persistence.
- Immutable, learner-private snapshots of the exact bounded provider-adapter
  StructuredCall, including failures/repairs, stage schema versions and hashes;
  owner-scoped export and privacy erasure.
- Structured definition scope and claim status, legacy-compatible necessity,
  test-runner evaluator metadata, immediate unknown state for meaning mismatch,
  and preservation of prior metadata when revising a definition.
- Recursive SQLite triggers so REPLACE cannot bypass existing immutable-history
  DELETE guards through the application's Database connection.

Oracle review identified concrete integration boundaries; regression tests first
demonstrated unoffered observations creating evidence, invalid observation batches
partially persisting, source-edit retargeting, truncated draft tails, dropped
retrieved units at final generation, and REPLACE history bypasses. These paths were
corrected without removing or weakening their behavioral assertions.

Final `npm run verify` passed on Node.js 24.19.0:

- **191 tests passed, one opt-in local-embedding test skipped, 47 test files passed.**
- Strict type check passed. Biome had zero errors and the existing five CSS warnings.
- Server and client production builds passed; the same two upstream Zod comment
  annotation warnings remain.
- No server source or server test module exceeds 250 nonblank/noncomment lines.
  Large orchestration, revision persistence, thread routes and question history
  were split by responsibility rather than suppressing type or size checks.
- TypeScript LSP remains unavailable and Markdown has no configured LSP; compiler
  and formatter checks were used. No LSP-clean result is claimed.

A separate driver personally exercised the built API over a live ephemeral
loopback HTTP server and isolated in-memory SQLite database, with explicit
synthetic demo generation and embeddings disabled. It verified:

1. Zero canonical rows, a provisional structured definition, and an existing
   retrieved unit present throughout planning/draft/both lints/final.
2. Project `desiredOutcome` survived goal updates; questions deduplicated and
   transitioned to parked; target promotion removed a deferred unit.
3. A parked thread rejected an ordinary selected turn with 409, and explicit
   resume reopened it in another conversation without losing its identity.
4. Meaning mismatch returned six unknown dimensions; definition revision retained
   structured scope; a test-runner observation retained runner/suite/result metadata.
5. Injected evaluator outage returned a usable response with `evaluationSkipped`;
   an explicit new-thread request created a different project thread.
6. **24 exported model-context snapshots** exactly matched their stored canonical
   JSON hashes, including failed calls. Another learner exported none of them.
7. Synthetic quality labels were excluded from the default report, which correctly
   had zero real samples, and appeared only with `includeSynthetic=true`.
8. Cross-learner thread lookup returned 404; erasure returned 204, revoked the
   session (401), removed private snapshots, and left zero foreign-key violations.

The driver closed its listener/database. Existing learner data and secrets were
not used. No frontend code changed and browser UI was not rerun. The environment
has no configured external provider credentials or `.env`, so no real external
LLM call, general educational-quality measurement, or longitudinal outcome study
was possible. Those remain explicitly incomplete; see
[quality evaluation](quality-evaluation.md) and the updated
[implementation status](phase-one-status.md). Earlier live-provider observations
are historical evidence, not claimed as rerun.

## Phase One browser integration: October 4, 2026

The production client build and isolated in-memory browser fixture were exercised
with Chrome at 1280×900, 768×900, and 375×900. The fixture used the explicitly
synthetic provider, disabled embeddings, and did not read the normal learner DB.

The existing recovery regression first failed at 375px with the composer right
edge at `442.78125px`. Runtime geometry showed the main pane's implicit grid
column resolving to `442.781px`; an explicit `minmax(0, 1fr)` column reduced the
surface to the viewport, after which the saved message was resolved exactly once.

Fresh browser evidence is under `/tmp/opencode/tutair-visual/`. It covers empty,
conversation, tracking, overview/question queues, goal dialog, thread drawer, and
ambiguous saved-turn recovery states. The capture driver recorded no uncaught page
errors and verified deferred-target promotion and single-message ambiguity recovery.

Three real-Chrome Lighthouse runs per form factor produced medians of
**100/100/100/100** for performance/accessibility/best-practices/SEO on both
desktop and mobile after correcting muted contrast, visible-label naming, initial
data layout shift, and fingerprinted-asset compression/caching. Lighthouse still
lists informational render-blocking/network-tree insights despite category scores
of 100; two mobile traces also logged `NO_LCP` Lantern diagnostics while still
producing complete category results. The six individual JSON reports and summary
are retained rather than presenting local synthetic-fixture scores as proof of
real-network performance.

React Doctor 0.9.14 scanned all 30 client source files with zero diagnostics.
Headed mode was unavailable because this container has no X server; screenshots,
interaction flows, and Lighthouse used the installed Chrome stable binary in
headless/CDP mode. No external LLM credential, educational-quality study, public
ingress, or deployed-network audit was performed in this run.

## Manual ChatGPT callback relay: October 11, 2026

Verified the explicitly enabled, exact-origin manual callback relay without using
a real OpenAI account. The integration fixture exercised authorization redirects,
PKCE, signed identity verification, issued-client validation, owner binding,
cross-learner rejection, denial, expiry, and replay rejection. `npm run verify`
passed with **267 tests passed, one skipped, and 62 test files passed**; the same
five pre-existing CSS warnings and two upstream Zod annotation warnings remain.

Playwright then completed the mocked OAuth flow at 375, 768, and 1280 pixels,
including retained invalid input, associated local error feedback, successful
connection, refreshed visible-model options, disconnect, and token non-disclosure.
All four browser scenarios passed. Independent visual review passed all six fresh
manual-error and connected-state captures with no remaining blockers.

The port-1455 process was restarted with manual mode restricted to the configured
DIM HTTPS origin; the baseline port-3000 process was not stopped. Public health
returned `{ "status": "ok" }`, and an authenticated public status request returned
`enabled: true`, `connected: false`, and `manualCallback: true`. The temporary
verification learner was erased afterward. No real upstream authorization was
attempted, so OpenAI account eligibility and dynamic registration remain external
limitations rather than verified behavior. TypeScript compilation passed; later
LSP diagnostic requests timed out, so this run does not claim a fresh LSP result.

## Live generation pipeline inspection: October 11, 2026

Added owner-scoped request summaries and lazy run details for persisted tutor
generation. Backend coverage verified the actual running stage while the tutor
POST remained pending, exact request-to-saved-message isolation, ordered failed
and repair attempts, resolved runtime model and failed-attempt usage, 404 for a
foreign owner or wrong conversation, recursive secret redaction, and lazy detail
loading. Historical missing model, usage, timing, and call snapshots remain null
or explicitly unavailable rather than being reconstructed.

Final `npm run verify` passed:

- **300 tests passed, one opt-in local-embedding test skipped, 71 test files passed.**
- Strict type checking, Biome, server compilation, and the production Vite build
  passed. Biome reported no warnings or errors.
- TypeScript LSP diagnostics reported zero errors across the scanned `src` and
  `tests` directories.

The full production-browser suite passed **13/13 scenarios**. It includes a paused
real HTTP fixture proving immediate live polling, truthful persisted-stage labels,
reload recovery, and terminal completion, plus a failed-stage record that remains
inspectable after reload. Fresh generation-inspector captures are:

- `.omo/evidence/generation-inspector-375.png`
- `.omo/evidence/generation-inspector-768.png`
- `.omo/evidence/generation-inspector-1280.png`

All three browser states asserted no horizontal document overflow. They use the
synthetic paused provider fixture and demonstrate application behavior and
responsive layout, not external model quality. No paid model call was made.

Targeted inspector regressions also verify that selected run details expose
persisted duration, token usage, error, and fallback metadata; a selected running
detail reloads when its summary becomes terminal and aborts that reload when the
drawer closes; and the progress clock adopts the persisted pipeline `startedAt`
instead of restarting after reload.

The isolated port-1455 process was rebuilt and restarted with its existing
database path, ChatGPT credential store location, callback settings, and exact
manual-origin allowlist. Baseline PID 8 remained running. Local and public health
both returned `{ "status": "ok" }` at
`https://tutair--3.remote-main-3.mj-y.com/api/health`.

## Answer provenance and private reasoning summaries: October 11, 2026

Added a lazy per-answer disclosure that separates immutable revisions provided to
recorded model calls, revisions created during the turn, and non-exhaustive
verified answer exposures. Historical links open the exact revision rather than
the current definition. Old turns without exact call snapshots explicitly report
that provenance is unavailable.

The owner-scoped private-debug setting is off by default. A model run snapshots
the setting before dispatch; enabled Responses calls request the official public
`reasoning.summary` output. Only typed summary text from a completed response is
stored. Chat Completions modes receive no unsupported parameter, and raw or
encrypted reasoning content is never requested, parsed, logged, or exposed.

Final verification passed with **308 tests passed, one opt-in local-embedding test
skipped, and 73 test files passed**. Strict type checking, Biome, server
compilation, and the production Vite build passed. The full production-browser
suite passed **14/14 scenarios**, including the new opt-in setting, public summary
display, exact revision navigation, and fresh provenance captures at 375, 768,
and 1280 pixels. No external model call was made.

The isolated port-1455 process was rebuilt and restarted without changing its
database path, callback settings, credential-store environment, or origin
allowlist. Local and public health returned `{ "status": "ok" }`. A temporary
live-browser learner enabled and disabled the debug setting through the deployed
UI, observed both persisted API states, and was erased with a 204 response.

## Restart recovery and document admission boundaries: October 11, 2026

Resumed from the committed multilingual document pipeline after the sandbox
restart. Added owner-scoped document reads, current-head search aggregation,
bounded candidate-specific retrieval, explicit concept-admission review,
demand-driven material preparation, and single-definition source-document rules.
Legacy records and existing duplicate units were not destructively merged.

Final `npm run verify` passed with **339 tests passed, one skipped, and 79 test
files passed**, plus type checking, Biome, and production builds. The restored
Chromium suite passed **14/14**. The lead separately exercised the provenance and
knowledge-management scenarios against the latest build: **2/2 passed**.
Header control bounds were checked at 375, 768, and 1280 pixels. Pending turns
still refresh automatically after reload and completion; the recovery test does
not require a manual retry to pass. Failure injection now targets the actual
`final` stage rather than the removed free-prose `draft` path.

The restarted image lacked browser libraries and had a broken sudo installation.
Chromium and its libraries were installed under the user's cache and
`/tmp/opencode/browser-libs/root`, without changing system privilege settings.
Browser checks used the isolated in-memory synthetic fixture, not the learner DB.

Three bounded real ChatGPT turn attempts uncovered missing English definitions,
a non-BCP-47 language value, and duplicate candidate keys across extraction
categories. Each received regression coverage. Definition validation now uses the
existing repair boundary without copying unknown-language legacy statements into
English documents; language tags and global key uniqueness are checked before
downstream persistence. **No successful real-provider full turn was observed for
this new pipeline before the call budget was exhausted.** The final key-validation
fix is deployed and fixture-tested, but real-provider end-to-end confirmation
remains outstanding. Earlier successful tutor turns predate this pipeline change.

A temporary demo deployment was detected during handoff and replaced before
delivery. The final public service uses the existing personal ChatGPT provider,
`chatgpt-preview.sqlite`, callback/origin configuration, and protected credential
store. In-flight counts were zero before restart; baseline PID 8 was untouched.
Local and external health checks pass. A healthy endpoint is not evidence of a
successful real-model answer or of educational/translation accuracy.
