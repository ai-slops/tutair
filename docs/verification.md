# Phase 1 verification record

Verified on September 19, 2026, using Node.js 24 in the provided DIM workspace.

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
