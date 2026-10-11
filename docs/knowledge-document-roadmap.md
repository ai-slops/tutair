# Knowledge document implementation milestones

Current checkpoint: October 11, 2026. Normative target:
[knowledge-document-contract.md](knowledge-document-contract.md).

## 1. Visibility and reuse: implemented

- Chat exposes exact knowledge revisions provided to model calls and created by
  the turn, independently of the optional provider reasoning-summary setting.
- Pipeline inspector exposes recorded inputs/outputs, versions, timing, failures,
  and repair history. Historical missing records remain unavailable.
- Unreviewed knowledge is eligible. Relevant knowledge from the active
  conversation/thread is included before bounded context selection.
- Exact compatible generated definitions are reused rather than blindly inserted.
  Different scopes/owners and incorrect or retired items are not merged.
- Correction appends a semantic revision and leaves historical evidence intact.
- Existing duplicate nodes are not destructively merged. Paraphrase equivalence
  is not guaranteed by exact-text reuse and still requires conservative resolution.

These foundations now feed immutable English source documents, localization
records, and document-derived final answers.

## 2. Document storage and management: implemented

Add immutable English source documents, explanation blocks, localized expressions,
and exact version links. Expose rich scope/features/claims/relations currently
hidden by the simplified knowledge detail view. Extend canonical imports and
provisional creation under the same language policy while preserving authority.

Acceptance checks:
- Legacy rows remain unchanged; migration is idempotent and uses `und` for legacy
  material rather than pretending translation has occurred.
- Wrong owner/revision/source block/language relationships are rejected.
- Translation-only updates do not reset semantic evidence or advance its revision.
- Korean and English search resolve to the same underlying knowledge identity.
- Management, export, review exclusion, and privacy deletion cover new records.

The implementation stores immutable document, block, and exact block-topic rows;
migrates existing statements byte-for-byte as `legacy` / `und`; creates English
documents for canonical imports and model-prepared provisional knowledge; and
shows language, role, version, staleness, and ordered blocks in Knowledge manager.

## 3. Preparation and final composition: implemented

Introduce a recorded preparation stage, persist reusable source/localized blocks,
then plan/select/render exclusively from eligible saved blocks. Extend progress
and inspector labels to distinguish content preparation from final composition.

Acceptance checks:
- Final selection recursively rejects arbitrary prose fields and unknown blocks.
- Every new answer reconstructs exactly from its saved segments and templates.
- One missing-material cycle is allowed; repeated incompleteness produces no
  ungrounded answer or exposure.
- Concurrent revision changes retain the exact prepared revision and block links.
- Incorrect/retired material cannot re-enter through planning, direct IDs, or
  localization. Generated canonical expressions remain learner-private.
- Public reasoning-summary settings do not affect document/exposure recording.

The recorded `preparation` stage may run once plus one bounded material retry.
The `final` stage accepts only ordered block IDs and layout enums. Server rendering,
segment offsets, hashes, answer composition, tutor message, and exposures are saved
in one transaction; reconstruction verifies the persisted answer hash.

## 4. Quality and operational evaluation

Use classical logic and its connection to type theory as one representative case,
with English source and Korean expression. Check scope, examples, distinctions,
translation fidelity, useful reuse on repeated questions, and complete coverage.
Add unrelated topics and negative controls rather than optimizing only this case.

Measure preparation reuse, total/stage latency, repair/material-cycle rates, and
known usage with the [experiment guidance](pipeline-experiments.md). Run isolated
fixtures first; real model calls require an explicit bounded budget. A source link
or successful runtime test is not proof of factual or educational correctness.
