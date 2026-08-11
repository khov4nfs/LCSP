# Legal Corpus Ingestion Implementation Specification

## Status

AUTHORITATIVE — A-to-Z RUNNABLE MVP

## Purpose

Define official-source validation, legal document ingestion, immutable snapshot/hash provenance, normalization, internal review/approval, and index-build handoff.

## Active References

- `docs/architecture/adr/adr-025-legal-corpus-source-architecture.md`
- `docs/specs/legal-corpus-source-spec.md`
- `docs/specs/legal-matching-domain-spec.md`
- `docs/implementation/persistence-implementation.md`
- `docs/implementation/queue-implementation.md`
- `docs/implementation/chromadb-vectorless-legal-retriever-implementation.md`

## UX and Actor Boundary

Legal corpus administration is performed by an **Internal Legal Operator** through internal API/CLI for MVP. It is not part of Manager or Developer customer-facing UX. Corpus approval does not create a third customer role and does not constitute legal certification.

## Source Validation

Before ingestion, the internal operator validates:

- source hostname against the approved official-source allowlist;
- HTTPS URL and redirect destination;
- source authority and tier;
- document identity expectations;
- retrieval policy and availability;
- absence of user-supplied arbitrary fetch targets.

Only a `LegalSource` resolved from the Admin-managed official-source catalog may be submitted for ingestion. Per-run manual source approval is not required. Requests must still prevent SSRF through catalog membership, host allowlisting, DNS/IP validation, redirect revalidation, response size limits, timeout, and content-type restrictions.

## Canonical Ingestion Command

```text
command.legal-source.ingest.requested.v1
```

Queue:

```text
lcsp.legal-source-ingest.v1
```

The command contains references only: LegalSource ID, source URL reference, requested document identity, target draft corpus version, correlation/idempotency keys, and actor reference.

## Ingestion Pipeline

```text
validated LegalSource
-> fetch official URL
-> validate response and final URL
-> store immutable PDF/HTML snapshot in S3-compatible storage
-> compute SHA-256 content hash
-> extract document identity/effective dates/source effect status/relationships
-> normalize chapter/article/clause/point hierarchy
-> create LegalDocument and LegalCorpusItem records in DRAFT corpus
-> audit provenance
-> event.legal-source.ingest.completed.v1
```

Failure publishes `event.legal-source.ingest.failed.v1` and leaves the document/corpus unavailable for retrieval.

## Snapshot Object Contract

Object key:

```text
legal-source-snapshots/{sourceId}/{documentId}/{contentHash}/{originalFileName}
```

Stored metadata includes source URL, final URL, retrieval timestamp, HTTP content type, content length, SHA-256 hash, source authority, document identity, and correlation ID. The object is immutable; a changed hash creates a new snapshot/version.

## Normalization

The parser preserves legal hierarchy:

```text
Document
-> Chapter (optional)
-> Article
-> Clause (optional)
-> Point (optional)
-> Appendix (optional)
```

Normalization rules:

- remove transport/formatting artifacts without changing legal meaning;
- preserve Vietnamese diacritics;
- retain official numbering and titles;
- store article/clause/point path on every corpus item/chunk;
- record source locator and content hash;
- flag uncertain identity, date, relationship, or hierarchy for manual review;
- never auto-approve extracted content.

Regex may support extraction but must not be the only validation mechanism. Parsed hierarchy, dates, document identity, and amendment/supersession relationships require review before approval.

## Failure Codes

| Failure | Behavior |
|---|---|
| Source not validated | `LEGAL_SOURCE_NOT_VALIDATED`; reject command |
| URL unavailable | `LEGAL_SOURCE_UNAVAILABLE`; bounded retry then failure |
| Redirect leaves allowlist | `LEGAL_SOURCE_REDIRECT_REJECTED`; fail closed |
| Response too large/type unsupported | `LEGAL_SOURCE_RESPONSE_REJECTED`; fail closed |
| Snapshot/hash failure | `LEGAL_SNAPSHOT_FAILED`; no normalization |
| Identity extraction failure | `LEGAL_IDENTITY_EXTRACTION_FAILED`; manual correction required |
| Source effect status conflicts with derived effective/repeal state, or is missing/unmapped | `LEGAL_EFFECT_STATUS_CONFLICT`; manual review; corpus version approval blocked (see `legal-corpus-source-spec.md` Source Effect Status) |
| Normalization failure | `LEGAL_NORMALIZATION_FAILED`; no approval |
| Content hash changed | create new document/snapshot staging version; do not mutate approved version |

## Review and Approval

Lifecycle:

```text
DRAFT -> APPROVED -> SUPERSEDED
```

Internal route contract:

```text
GET  /internal/v1/legal-corpus/versions/:versionId
POST /internal/v1/legal-corpus/versions/:versionId/approve
POST /internal/v1/legal-corpus/versions/:versionId/reject
```

Approval validates:

- every source resolves from the Admin-managed official-source catalog;
- document number/type/title/issuer are correct;
- issue/effective dates are present or explicitly reviewed;
- `source_effect_status` is captured and consistent with the derived effective/repeal state (no unresolved `LEGAL_EFFECT_STATUS_CONFLICT`);
- article/clause/point normalization is accurate;
- amendment/supersession relationships are reviewed;
- snapshot and normalized content hashes are recorded;
- review scope and operator identity are recorded.

Approval transaction:

```text
create CorpusApprovalRecord
-> set LegalCorpusVersion APPROVED
-> write AuditEvent
-> create OutboxEvent(command.legal-index-build.requested.v1)
```

Rejection creates a decision record and keeps the version unavailable. Approved content is immutable. Any content/date/relationship correction requires a new DRAFT version and reapproval.

## Index Build Handoff

Canonical command/event names:

```text
command.legal-index-build.requested.v1
event.legal-index-build.completed.v1
event.legal-index-build.failed.v1
```

Retrieval remains blocked until the approved version has a successful ChromaDB legal index completion record with hierarchy, xref and citation allowlist metadata verified.

## Audit Requirements

Audit source-catalog resolution, ingestion request/start/completion/failure, snapshot/hash creation, normalization warnings, automated validation outcome, corpus activation/rejection/supersession, and index-build request. Audit metadata is redacted and reference-only.

## Acceptance

- Arbitrary URLs cannot be fetched.
- Official-source snapshot, final URL, retrieval time, and content hash are recorded.
- Legal hierarchy and citation locators survive normalization.
- No DRAFT/rejected/unindexed corpus is available to legal matching.
- Approval is attributable to an Internal Legal Operator and immutable.
- Manager/Developer UI contains no corpus administration screens.

## Non-Claims

- Admin-managed source membership does not guarantee permanent source availability.
- Corpus approval is not legal certification.
- This specification does not authorize broad web crawling.
- This document is not implementation-readiness certification.
