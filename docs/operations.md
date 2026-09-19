# Operation and privacy

## Runtime boundary

The application is a single Node.js process serving an HTTP API and built browser
assets. SQLite is the local-first persistence layer. Do not place the live
database on a network filesystem, or run independent application instances
against the same file. PostgreSQL is a future deployment alternative, not a
required external service for this local runtime.

Keep the database, `.env`, model cache, exports, and session cookies private.
The repository ignores local data and credentials. An exported learning archive
contains private conversations and assessment evidence; treat it as sensitive.

The default database is `~/.local/share/tutair/tutair.sqlite`, configurable with
`TUTOR_DB_PATH`. This places DIM learning data in its persistent agent-home volume
rather than Git. The process binds `127.0.0.1` by default; set `HOST` only when a
container or network deployment explicitly requires another interface.

## Optional canonical import

Canonical knowledge starts empty. Nothing in `examples/` is seeded automatically.
Review `examples/fsm.yaml` before importing it as trusted knowledge. Set a strong
server-side `TUTOR_CANONICAL_IMPORT_TOKEN`, restart, and send the YAML text to
`POST /api/knowledge/import` as `{ "format": "yaml", "content": "..." }` with
both your session cookie and the `x-tutair-canonical-token` header. Keep that
operator token out of browser storage and source control. Normal learner
sessions cannot publish or revise shared canonical knowledge.

Imports are transactional. Relations point to keys in the same import document
and are linked to the exact imported revisions. Reimporting an existing key
appends a revision only when its semantic scope and kind remain compatible;
changed meanings require a new key, not an overwrite.

## DIM integration

`.dim` remains the original development-environment lifecycle. The application's
entrypoint remains `node app/server.mjs`. At startup it:

1. Sets the working directory to the repository root.
2. Loads `.env` if present, without replacing values already supplied by the host.
3. Installs the lockfile dependencies if absent and builds the runtime and UI.
4. Starts the server on `PORT` (default 3000), binding loopback by default.
5. Registers the `tutair` development service with DIM's shared gateway and prints
   its HTTPS URL. Set `TUTOR_INGRESS` if the ingress is not named `https-ts`.

Use the externally configured DIM URL rather than assuming port 3000. The
development URL routes through the shared gateway to the application. Do not
bind the application to the gateway's own port or stop the shared gateway.

DIM's stop/start preserves its workspace. Discarding a workspace can remove its
checkout and inner-engine data. Back up application data and model configuration
before discarding. Git commits do not back up learning data.

### Managed Git DNS

Some DIM templates do not propagate the `dim-gitea` host alias into the nested
agent container. In that case local commits work, but `git push` fails with
`Could not resolve host: dim-gitea` even when valid credentials are present.

The supported host-side fix is to pass the controller-approved `hostAliases`
from `DIM_PROJECT_MANIFEST` into the agent's Compose `extra_hosts`. The manifest
is supplied to project-root setup and is not necessarily mounted inside the
unprivileged agent. Do not guess a Git host IP or print credentials. An operator
with access to the workspace setup must repair the alias injection, then retry
the normal push without force.

References:

- [DIM project workspace contract](https://github.com/slop-lab/dev-infra-manager/blob/main/docs/project-workspaces.md)
- [DIM setup alias injection](https://github.com/slop-lab/dev-infra-manager/blob/main/.dim/setup.sh)

## Session model

A local signup creates an opaque HttpOnly session cookie. Browser profiles are
independent learners; private records are scoped by the authenticated session,
not by a client-supplied learner ID. Losing the cookie can mean losing access
unless an operator restores the session and database together. This is not an
email/password account-recovery service.

Use HTTPS when accessed remotely. A session cookie is a bearer credential. This
Phase 1 deployment is intended for a trusted local environment or a controlled
DIM ingress, not an unrestricted public multi-tenant SaaS. Protect externally
reachable ingress with appropriate access controls and resource limits.

## Preservation and deletion

Normal message deletion creates a tombstone rather than rewriting the historical
record. Editing a message preserves its previous content in the event history.
Evidence refers to the assessed revision and source, not whatever definition
happens to be current today.

The explicit privacy-erasure operation deletes learner-owned source and derived
data and revokes the session. That operation is the deliberate exception to
append-only history. An operator must separately remove backups and previously
downloaded exports. SQLite logical deletion is not a promise of forensic or
cryptographic erasure from disk snapshots, journals, or storage-controller media.

## Backup and recovery

Stop the server before copying the SQLite database and any remaining WAL/SHM
files together, or use SQLite's online backup mechanism. Never copy only the
main file while writes are active and assume the backup is consistent. Store
credentials separately with restricted filesystem permissions. Restore to the
same application version first, verify access and a conversation, then upgrade.

Model artifacts are replaceable and need not be backed up, but caching them
allows subsequent local semantic searches without network downloads.

## Provider failures

The learner's message must survive model unavailability. Inspect the returned
turn trace and model-run failures rather than assuming an unanswered message was
lost. Fix the provider URL, credentials, model support, or connectivity and retry
deliberately; do not repeatedly submit the same private content without checking
the conversation.

Do not put API keys in browser settings, query strings, commits, or screenshots.
Provider-side logs and retention are outside Tutair's local privacy-erasure
boundary. Review the chosen provider's retention policy before using sensitive
learning material.
