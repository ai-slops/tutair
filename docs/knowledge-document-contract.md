# Knowledge document and answer-material contract

Status: approved target architecture, October 11, 2026. This extends the Phase One
contract following the user's request. Requirements below are not a declaration
that the new document store and composition pipeline are already implemented.
See [implementation milestones](knowledge-document-roadmap.md).

## Authority, language, and eligibility are independent

- Both provisional and canonical knowledge use an English source document and
  separate localized expression documents. English is a representation policy,
  not an authority level.
- Model-generated material remains provisional/model-generated. Translating,
  reviewing, or using a document never silently promotes it to canonical.
- Unreviewed eligible knowledge may be retrieved, used, and corrected. Review is
  not a prerequisite for answering. Incorrect current revisions and retired units
  remain excluded under the existing learner-specific review policy.
- Matching titles alone never establish identical meaning. Reuse must preserve
  kind, scope, ownership, exact revision identity, and uncertainty boundaries.
- Extraction classifies durable named concepts separately from requests for
  scopes, examples, contrasts, or other answer material. Only an explicit,
  independently validated `create` review may persist a new concept. Omitted,
  conflicting, unverified, or ignored decisions create nothing. Material requests
  attach only to an offered exact revision or are skipped.
- Candidate resolution may use a bounded set of lexical/vector probes built from
  extracted labels, definitions, and semantic scopes. Retrieval proposes candidates;
  vector or title similarity alone never authorizes a merge.

## Immutable documents and localized expressions

The existing knowledge unit and semantic revision retain their identities.
Documents are additional immutable, separately versioned records referencing an
exact `knowledgeRevisionId`, not replacements for historical revision rows.

Each document records its ID, owner or shared authority, exact knowledge revision,
role, language tag, document version, origin/model run/source references, creation
time, and any superseded document ID. Roles are:

- `english_base`: the English source representation, with language `en`.
- `localization`: an expression in a specified BCP-47 language, referencing an exact
  English source document version.
- `legacy`: existing material whose language has not been verified, marked `und`.

Generated expressions of shared canonical revisions are learner-private and
model-generated; they do not gain shared editorial authority from the referenced
revision. A translation edit must not increment the underlying semantic revision
or move learner evidence. A changed English source does not make older translations
current automatically; their exact source link remains visible.

Documents contain standalone explanation blocks: definition, scope, feature,
claim, example, contrast, prerequisite, caveat, or procedure step. Blocks have
stable IDs within immutable document versions, ordering, topic/revision links,
and provenance. Localized blocks reference exact source block IDs and retain the
same topic identity; target-only factual additions require source material first.
Every English document version has exactly one definition block. Adding an example,
contrast, or procedure creates a new immutable document version carrying that same
definition; an automatic definition change is rejected and requires an explicit
semantic correction revision.

Richness is task-driven, not a minimum word count. A useful concept document may
include a concise definition, applicability, distinguishing principles, an example,
a contrast or common misconception, and source/uncertainty information. Do not
inflate every concept into an encyclopedia. Never invent citations to make a
generated explanation appear source-supported.

## Separate preparation from final composition

The target pipeline is:

1. Evaluate the learner's message using existing evidence rules.
2. Identify required topics, requested explanation material, and response language.
3. Resolve topics against eligible exact current knowledge revisions.
4. Plan exact material needs by revision and block type.
5. Prepare only missing reusable English blocks and localized expressions; validate and
   persist them before they can be offered to final composition.
6. Select and order blocks with the final model; render them deterministically.
7. Validate/lint the rendered result and atomically persist its message, composition
   provenance, and exposures.

Preparation is responsible for content. Final composition is responsible for
selection, ordering, and layout. A prompt asking a free-prose final model to cite
documents is not sufficient to meet the required coverage invariant.

Final composition may return only validated document/block references and layout
enums. It cannot inject arbitrary factual text, examples, headings, or substantive
transitions. Such content must first exist in a document block. Non-explanatory
formatting and operational notices may use versioned system templates.

If preparation is incomplete, permit at most one explicit missing-material cycle
for already-resolved topics. A second request, unknown topic, or unsupported block
fails with a recorded error rather than publishing ungrounded prose. Schema-repair
attempts and missing-material cycles are distinct events. Batch preparation across
topics and reuse suitable documents to avoid one model call per concept.

## Verifiable answer coverage

- Persist each rendered segment's exact source block/template, order, and character
  span against the original tutor message event.
- Reconstruct the message from those sources byte-for-byte and check its content
  hash. Document IDs alone do not demonstrate explanation coverage.
- Every explanatory segment must originate in an immutable document block; every
  localized block must trace to its English source and exact semantic revision.
- Derive exposure from the revision topics actually rendered. Do not infer mastery
  from an explanation, and never reattach old exposure to a newer revision.
- Coverage establishes where content came from, not that it is true or faithfully
  translated. Accuracy and translation fidelity still require review and testing.

## Migration and inspection

Preserve existing definitions, claims, evidence, exposures, reviews, and message
events. Legacy migration must be idempotent and must not label Korean or unknown
text as English. Conversion produces new linked records, never an in-place rewrite
or automatic authority promotion. Privacy erasure remains the explicit exception
to history preservation.

Chat document provenance remains available whether debugging summaries are enabled
or not. Distinguish material offered to the model, created revisions/documents,
and material actually rendered. While the old pipeline remains active, exposure
annotations are partial evidence, not a complete answer-coverage claim.

Only provider-published reasoning summaries may be optionally requested/stored.
Do not request or claim access to hidden reasoning. Preparation documents contain
learner-facing explanation content, not internal chain-of-thought. Debug settings
must never suppress ordinary document provenance.

The UI must expose English and localized content, exact version links, provenance,
review status, and stale translation state without implying that a reviewed
semantic revision is also a reviewed translation.

Search projects one active record per eligible knowledge identity. That record uses
the current semantic revision, its active English document head, aliases, and
non-stale localizations. Historical revisions and superseded or stale document
blocks remain inspectable but are not active retrieval records and cannot gain rank
through duplicate block rows.
