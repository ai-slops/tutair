# Tutair

A local-first AI tutor that starts with your question or project, not a required
curriculum. It builds the minimum provisional knowledge structure needed for the
conversation and keeps the evidence behind what it thinks you understand.

**An explanation is exposure, not proof of understanding.** Learner evidence is
attached to an immutable definition revision and tracked separately across
recognition, recall, explanation, application, discrimination, and transfer.

## Run

Requirements: Node.js 24.22.0 through 26.x, npm, and a writable local directory. SQLite is
built into Node; no database service is required. The SQLite experimental warning
on some Node versions is expected.

```sh
cp .env.example .env
npm ci
npm start
```

Outside DIM, open `http://localhost:3000`. Inside DIM, the server registers its
loopback port with the shared development gateway and prints its external URL.
The existing `.dim` lifecycle files are preserved.

`npm start` builds the application before starting the server. DIM's original
`node app/server.mjs` command also installs locked dependencies when its protected
root-lock marker is absent or stale, so a fresh agent can start without changes to
its image. Initial installation and the first local embedding model download need
network access.

### Choose a tutor provider

The default is **disabled**, not a pretend AI response. Edit `.env` and restart:

```dotenv
TUTOR_PROVIDER=openai
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-provider-key
TUTOR_MODEL=gpt-4.1-mini
TUTOR_EMBEDDING_PROVIDER=local
```

By default, use a provider/model supporting strict JSON Schema structured output.
For streaming-only gateways that reject `response_format` and tool calls, set
`TUTOR_OPENAI_MODE=compatibility`. This mode sends the schema in the model prompt,
receives SSE text deltas, and still validates the resulting JSON against the same
runtime schemas. A single outer JSON code block is accepted as transport
formatting; prose surrounding JSON, malformed JSON, incomplete streams, and
truncated output are rejected. It does not provide API-level constrained
generation and never activates as a hidden fallback.
A compatible local inference service can use its own base URL and model.
Provider credentials stay on the server. Model requests contain relevant private
learning context: configure only a provider you trust with that data.

#### Personal Sign in with ChatGPT (local opt-in)

Tutair can use OpenAI's official open-source Sign in with ChatGPT flow and the
public Responses API. It is disabled by default and is intended only for personal
local testing:

```dotenv
TUTOR_PROVIDER=chatgpt
TUTOR_CHATGPT_PERSONAL=true
TUTOR_CHATGPT_CALLBACK_PORT=1455
TUTOR_EMBEDDING_PROVIDER=local
```

Open `http://127.0.0.1:1455`, create the local learner session, then use
**Settings → Session & model → Connect ChatGPT**. After authorization returns,
refresh the session and choose one of the account models shown by OpenAI. Tutair
uses only models marked `visibility: list`. The authorization client is public:
there is no client secret. The server validates state, PKCE S256, JWT signature,
issuer, audience, expiry, nonce, subject, issued client, account continuity, and
the `chatgpt.tokens.use.direct` scope.

The callback is exactly `http://127.0.0.1:1455/auth/callback`; `localhost` is not
substitutable. For a container or remote VM, forward that loopback port to the
server's actual port and browse through the forwarded loopback address. Example
when Tutair listens on port 3000 in the VM:

```sh
ssh -N -L 1455:127.0.0.1:3000 user@vm
```

Do not invent an external callback URL or trust forwarded-host headers. Tutair
rejects authorization initiation from non-loopback origins. Its credential file
defaults to `~/.config/tutair/chatgpt.json`, is replaced atomically with mode
`0600`, and is never included in UI responses or learning exports. Each grant is
bound to the authenticated local learner, issued client, validated subject, and
persistent `urn:uuid:<UUIDv4>` host ID. Existing stores with a legacy bare UUID
are migrated without changing that UUID or any learner grants. Privacy deletion
and Disconnect remove that learner's local grant. The store coordinates same-path
mutations within one server process; do not share one credential path between
multiple Tutair processes. A real browser login is not exercised by the automated
fixture suite.

For a controlled remote Tutair origin where port forwarding is unavailable, an
app-specific manual relay can be enabled explicitly:

```dotenv
TUTOR_CHATGPT_MANUAL_CALLBACK=true
TUTOR_CHATGPT_MANUAL_ORIGINS=https://tutair.example
```

Open Settings on that exact origin and choose **Continue with ChatGPT**. Complete
the legitimate OpenAI authorization. When the browser cannot load the resulting
`http://127.0.0.1:1455/auth/callback?...` address, copy the full address-bar URL,
return to the same Tutair learner, paste it into **Full localhost callback URL**,
and complete the connection. The field is posted in the request body and clears
after success; Tutair does not put it in browser history or logs.

Authorization state is in memory. After restarting Tutair, close any authorization
page opened before the restart and choose **Continue with ChatGPT** again; an old
URL cannot complete the new server session.

This relay is a Tutair fallback, not OpenAI's documented remote-VM procedure. The
registered redirect remains the exact loopback URL, and all state, PKCE, nonce,
issued-client, identity, scope, expiry, replay, and learner-owner checks still
apply. OpenAI's documented VM procedure is to authorize locally and transfer the
protected credential record over a secure channel while preserving the VM host
ID. If OpenAI reports that dynamic client registration or this client is
unsupported, Tutair cannot bypass that upstream restriction; use the documented
credential-transfer path or a supported deployment.

ChatGPT-plan inference always sends `stream: true` and `store: false`, accepts a
result only after `response.completed`, and rejects failed, incomplete, or
truncated streams. Tutair buffers and validates that stream server-side; the UI
does not render live model deltas. It does not silently fall back to API-key billing or demo mode.
This preview grants model inference, not ChatGPT conversation history or other
account context. See the [official OSS sign-in guide](https://developers.openai.com/siwc/token-sharing-open-source/sign-in)
and [preview limitations](https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations).

API-key users may opt into the same Responses adapter with
`TUTOR_PROVIDER=openai` and `TUTOR_OPENAI_MODE=responses`; existing strict and
compatibility Chat Completions modes remain unchanged.

For a deterministic, credential-free FSM walkthrough:

```dotenv
TUTOR_PROVIDER=demo
TUTOR_EMBEDDING_PROVIDER=local
```

Demo output is explicitly synthetic. It exercises the persistence and tracking
pipeline; it is not a general-purpose model, a knowledge authority, or a measure
of educational quality. A failed real-provider request never silently switches
to demo mode.

Compatibility mode may take longer because each tutor turn performs several
independent model calls. Tutor submissions allow up to five minutes; other
browser requests retain their shorter timeout. A schema-invalid stage receives
at most one regeneration request containing the validation issues. Both attempts
remain in the model-run history; the schema itself is never relaxed.

Exposure annotations use exact source quotes when possible. Unverifiable
annotations are omitted and audited with `exposureTrackingSkipped`, rather than
fabricating evidence or discarding an otherwise usable answer. Verified
annotations and learner-evidence validation remain strict.

### Generation pipeline records

While a tutor turn runs, the workspace shows only stages actually persisted by
the server. **View generation details** opens the same request-scoped record for
live, recovered, and historical replies. The summary is polled while work is
active; the bounded structured call, validated or failed output, versions,
repair provenance, and decision traces load only when a recorded run is selected.

Records are correlated through the tutor request's saved learner message, not by
nearby timestamps or another turn in the conversation. Failed attempts and their
repair attempts remain separate. Missing historical model, usage, timing, or
input snapshots are shown as unknown/unavailable—not zero and not reconstructed.
All reads are authenticated and learner-scoped, and diagnostic payloads are
redacted for credentials and tokens; hidden chain-of-thought is never requested
or exposed. See the [backend API](docs/backend-api.md#generation-pipeline-inspection)
for the normative contract.

Every tutor reply also keeps a visible **Sources & knowledge** disclosure. It
loads lazily and separates immutable revisions actually provided to model calls,
revisions created during the answer, and revisions named by verified answer
exposures. Exposure annotations are explicitly non-exhaustive. Links select the
exact historical revision in Knowledge manager, even after a newer revision
becomes current. Older answers without exact run snapshots say provenance is
unavailable rather than inferring it from current knowledge or search results.

In **Settings → Session & model → Private debugging**, each learner can opt in to
**Save provider reasoning summaries for debugging**. It is off by default and
applies only to new Responses API model runs. When enabled, Tutair requests the
official `reasoning.summary: "auto"` output and privately stores only a public
provider summary returned with the completed response. Raw reasoning tokens,
encrypted reasoning content, and hidden chain-of-thought are never requested or
stored. Chat Completions modes receive no unsupported parameter. An enabled model
that returns no summary is shown as unavailable without an automatic retry;
previously retained summaries remain private until learning data is erased.

### Knowledge review lifecycle

Open **Knowledge** in the workspace header to browse definitions, provenance,
immutable revisions, and learner-specific review history. Review status describes
definition accuracy, not learner mastery or canonical authority.

- **Reviewed** records that the current revision was checked. A new revision starts
  unreviewed.
- **Incorrect** requires a reason and excludes that exact revision from future
  search and tutor-generation context for the current learner.
- **Retired** requires a reason and excludes the whole unit across revisions until
  it is explicitly restored.
- **Restore** requires explicit confirmation and removes retirement. A current
  revision still marked incorrect remains excluded until reviewed or corrected.

Review events are append-only and learner-scoped, including reviews of shared
canonical definitions. Retirement never physically deletes knowledge, evidence,
exposures, conversations, or revision history.

### Semantic retrieval

Local semantic search uses a pinned, quantized `Xenova/all-MiniLM-L6-v2` model
through Transformers.js on CPU. The model revision, quantization, pooling,
normalization, dimensions, and truncation policy are part of the embedding
profile. The cache defaults to `~/.cache/tutair/models` and can be changed with
`TUTOR_MODEL_CACHE`.

MiniLM is primarily an English embedding model. It should not be interpreted as
reliable cross-language semantic equivalence, particularly for Korean-only
phrasing. Full-text retrieval remains available, and model-based knowledge
resolution distinguishes meaning rather than relying on vector proximity.
For multilingual deployments, configure a suitable remote embedding model.

If semantic embedding is unavailable, search reports a lexical-only degraded
mode instead of calling keyword matching semantic search. Indexes and embeddings
are replaceable projections; original conversations remain the source records.

## Development

```sh
npm run typecheck
npm run check
npm test
npm run build
npm run test:browser
```

The browser suite builds production assets and starts an isolated in-memory,
synthetic-provider fixture on an ephemeral loopback port. It does not read the
normal learner database or demonstrate educational effectiveness. Headed browser
review requires an X server; CI/headless Chrome still exercises the real rendering
engine and responsive workflows.

Run the real local embedding integration test, including the initial model
download when needed:

```sh
TEST_LOCAL_EMBEDDINGS=1 npm test -- tests/server/local-embeddings.test.ts
```

For frontend development, start the API on port 3000 and run `npm run dev` in a
second terminal. Vite proxies `/api` to port 3000. Do not expose the Vite server as
a production service.

## Documentation

- [Original Phase 1 requirements, condensed with section numbering](docs/phase-one-specification.md)
- [Phase 1 implementation status, requirement mapping, and next work](docs/phase-one-status.md)
- [Phase 1 acceptance contract](docs/phase-one-contract.md)
- [Backend API](docs/backend-api.md)
- [Operation and privacy](docs/operations.md)
- [PART runtime ownership and recovery limits](docs/part-runtime.md)
- [Learner model and resolution policy](docs/learner-model.md)
- [Verification record and environment limitations](docs/verification.md)
- [Real-provider quality evaluation and remaining validation](docs/quality-evaluation.md)
- [Pipeline experiment readiness, improvements, and test plan](docs/pipeline-experiments.md)
- [English source documents, localized expressions, and grounded composition contract](docs/knowledge-document-contract.md)
- [Observable English intermediates, localized output, and incident diagnosis](docs/observable-language-contract.md)
- [Knowledge document implementation milestones](docs/knowledge-document-roadmap.md)
- [Design system](DESIGN.md)

Phase 2 clustering, automatic canonicalization, editorial workflows, public
knowledge contributions, personal KB, gamification, and spaced repetition are
intentionally excluded. Their source material is retained through revisioned
knowledge, model decisions, learner evidence, corrections, and conversation
provenance.
