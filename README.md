# Tutair

A local-first AI tutor that starts with your question or project, not a required
curriculum. It builds the minimum provisional knowledge structure needed for the
conversation and keeps the evidence behind what it thinks you understand.

**An explanation is exposure, not proof of understanding.** Learner evidence is
attached to an immutable definition revision and tracked separately across
recognition, recall, explanation, application, discrimination, and transfer.

## Run

Requirements: Node.js 24 or 26, npm, and a writable local directory. SQLite is
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
`node app/server.mjs` command also installs locked dependencies when absent, so a
fresh agent can start without changes to its image. Initial installation and the
first local embedding model download need network access.

### Choose a tutor provider

The default is **disabled**, not a pretend AI response. Edit `.env` and restart:

```dotenv
TUTOR_PROVIDER=openai
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_API_KEY=your-provider-key
TUTOR_MODEL=gpt-4.1-mini
TUTOR_EMBEDDING_PROVIDER=local
```

Use a provider/model that supports the structured-output schema required by the
runtime. A compatible local inference service can use its own base URL and model.
Provider credentials stay on the server. Model requests contain relevant private
learning context: configure only a provider you trust with that data.

For a deterministic, credential-free FSM walkthrough:

```dotenv
TUTOR_PROVIDER=demo
TUTOR_EMBEDDING_PROVIDER=local
```

Demo output is explicitly synthetic. It exercises the persistence and tracking
pipeline; it is not a general-purpose model, a knowledge authority, or a measure
of educational quality. A failed real-provider request never silently switches
to demo mode.

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
```

Run the real local embedding integration test, including the initial model
download when needed:

```sh
TEST_LOCAL_EMBEDDINGS=1 npm test -- tests/server/local-embeddings.test.ts
```

For frontend development, start the API on port 3000 and run `npm run dev` in a
second terminal. Vite proxies `/api` to port 3000. Do not expose the Vite server as
a production service.

## Documentation

- [Phase 1 acceptance contract](docs/phase-one-contract.md)
- [Backend API](docs/backend-api.md)
- [Operation and privacy](docs/operations.md)
- [Learner model and resolution policy](docs/learner-model.md)
- [Verification record and environment limitations](docs/verification.md)
- [Design system](DESIGN.md)

Phase 2 clustering, automatic canonicalization, editorial workflows, public
knowledge contributions, personal KB, gamification, and spaced repetition are
intentionally excluded. Their source material is retained through revisioned
knowledge, model decisions, learner evidence, corrections, and conversation
provenance.
