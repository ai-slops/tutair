# PART runtime ownership

Tutair uses PART `0.1.0` as its model wire and in-process operation runtime. The
three packages are pinned exactly because PART is pre-1.0 and requires Node.js
24.22.0 or newer. Tutair supports that runtime through Node.js 26.x and rejects
Node.js 27 or newer until the package engine range is deliberately updated.

| Concern | Owner | Contract |
| --- | --- | --- |
| Tutor policy, prompts, Zod schemas, one repair attempt, fallback flags | Tutair | Domain behavior is unchanged and remains visible in model-run records. |
| Responses and Chat Completions request encoding and stream decoding | PART adapters | Tutair applies narrow post-encode transforms for its existing wire contracts. |
| Credentials and model selection | Tutair | OAuth grants remain learner-bound; tokens are bound at invocation and never enter profiles, context, traces, or PART storage. |
| HTTP delivery and non-2xx diagnostics | Tutair transport | One fetch attempt, full-body cancellation, bounded sanitized error details, request ID preservation, and no automatic retry. |
| Turn, stage, and nested model operation supervision | PART operations | Attached children inherit cancellation and the five-minute root deadline. Tutair persists separate runtime IDs rather than replacing application UUIDs. |
| Provider-effect intent and settlement | PART stored boundary | The sidecar stores IDs, digests, phase, and effect state only. It does not store prompts, outputs, credentials, headers, reasoning, or learner identity. |
| Request, model-run, provenance, and inspection history | Tutair SQLite | The application database remains authoritative for learner-visible history and privacy deletion. |

## Wire modes

- `responses` uses the PART Responses adapter with explicit input history,
  `stream: true`, `store: false`, and `include: []`. Tutair requests
  `reasoning.summary: "auto"` only when the learner enables private debugging.
  Only returned `summary_text` is persisted; native, encrypted, and hidden
  reasoning is discarded.
- `strict` uses the PART OpenAI-compatible adapter with the existing strict
  `response_format` and stage temperature. It uses one non-streaming provider
  response.
- `compatibility` uses the same PART compatible adapter with streaming,
  `max_tokens: 8192`, schema-in-prompt context, and no response format, tools,
  temperature, or PART-added `stream_options`.

Request transforms run before PART recomputes the actual outgoing-body digest.
Embeddings remain outside PART because PART 0.1.0 has no embedding gateway.

## Recovery and limits

On startup, PART marks an intent without settlement as abandoned with an unknown
effect. Tutair then marks matching application requests and runs as requiring
reconciliation. It never automatically reruns a provider effect. This is crash
classification, not durable workflow resumption: PART 0.1.0 advertises no durable
waits or resumable handlers, and the local operations supervisor is in memory.

The sidecar is `<main database>.part-runtime.sqlite`, opened with SQLite WAL and
mode `0600`. It is a local single-store implementation, not a network-filesystem
or distributed-writer backend. Its plaintext digests and IDs are opaque after
the learner-owned mapping in the main database is erased, but digests are not
encryption. Back up the sidecar with SQLite's backup API alongside the main
database.

Known token usage is persisted when the provider reports it. Unknown usage stays
unknown; Tutair does not synthesize zero usage or claim provider cost accounting.
PART's bounded progress stream is metadata-only and non-replaying. Tutair's main
database timeline remains the inspection source of truth.
