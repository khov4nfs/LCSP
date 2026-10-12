# ADR-025 - Legal Corpus Source Architecture

> **Historical pre-freeze documentation.** This document records the earlier design or implementation. Current architecture authority is [the canonical Architecture Freeze](../../../reports/architecture-freeze-migration-manifest.md); current runtime names and release status must be read there and in the current PR #367 receipts.

## Status

Accepted for A-to-Z Runnable MVP (Phase 5.2J)

## Decision Context

```text
PROJECT_OWNER_LOCKED
```

Legal corpus must be derived from provenance-validated official sources. Approved as part of SPRINT-CHANGE-PROPOSAL-5.2J (2026-06-23).

Previous approach (local JSONL corpus seed, no defined source architecture) superseded for the A-to-Z MVP happy path. JSONL seed retained as test fixture only.

## Decision

```text
LEGAL_CORPUS_FROM_PROVENANCE_VALIDATED_SOURCES
CORPUS_REVIEW_APPROVAL_IS_MANDATORY_GATE
FAIL_CLOSED_ON_UNAVAILABLE_SOURCES
```

## Source Hierarchy

```text
PRIMARY SOURCES (legally authoritative)
  → Official government legal databases
    - vbpl.vn (candidate — SOURCE_VALIDATION_REQUIRED)
    - vanban.chinhphu.vn (candidate — SOURCE_VALIDATION_REQUIRED)
  → Ministry-issued decrees, circulars, decisions

SUPPLEMENTARY SOURCES (contextual, not legally authoritative)
  → Regulatory guidance documents
  → Official FAQs and implementation guidance
```

> **Source Validation Required:** Internal Legal Operator must validate technical accessibility of vbpl.vn and vanban.chinhphu.vn before ingestion implementation. Do not claim confirmed accessibility.

## Required Corpus Metadata Per Document

| Field | Requirement |
|---|---|
| Source hierarchy | PRIMARY or SUPPLEMENTARY |
| Official source URL | Required with HTTP retrieval metadata |
| Legal document identity | Decree/circular/decision number, type |
| Issuing authority | Government body |
| Issue date | Publication date |
| Effective start date | When legal effect begins |
| Effective end date | When document expires or is superseded (if known) |
| Amendment relationships | Supersedes / superseded-by / amends |
| Original document snapshot | Immutable copy at ingestion time |
| Content hash | SHA-256 of normalized content |
| Normalized structure | Chapter/article/clause/point |
| Corpus review approval record | Approval authority, date, status |
| LegalCorpusVersion reference | Immutable versioned snapshot reference |

## Ingestion Requirements

1. Fetch from official URL with HTTP metadata.
2. Store immutable original document snapshot with SHA-256 hash.
3. Extract legal document identity.
4. Extract effective dates.
5. Record amendment relationships.
6. Parse hierarchical structure (chapter/article/clause/point).
7. Submit to Corpus Review; block production use until approved.
8. On approval, create immutable `LegalCorpusVersion` with version hash.
9. Define and implement refresh policy.

## Corpus Unavailability Behavior

```text
If source URL returns error or document is unavailable:
  → LEGAL_SOURCE_UNAVAILABLE audit event
  → Ingest job failed
  → Classification requiring the document remains BLOCKED
  → System must not synthesize legal content from unavailable sources
```

Fail-closed behavior is `PROJECT_OWNER_LOCKED`.

## Legal Corpus Review/Approval Gate

`PROJECT_OWNER_LOCKED` — formal corpus approval gate required before corpus enters production use.

| Step | Requirement |
|---|---|
| Review authority | Internal Legal Operator |
| Approval record | `CorpusApprovalRecord` with authority, date, scope, status |
| LegalCorpusVersion creation | Only after approval; immutable after creation |
| Corpus use gate | Classification blocked if corpus version not approved |

## LegalCorpusVersion Contract

```text
LegalCorpusVersion:
  id: UUID
  version_hash: SHA-256 of all included document content hashes
  created_at: timestamp
  approved_at: timestamp
  approved_by: authority identifier
  approval_record_id: UUID
  status: DRAFT | APPROVED | SUPERSEDED
```

Once approved, a `LegalCorpusVersion` is immutable. Classification must pin to approved corpus version at assessment start.

Canonical corpus lifecycle vocabulary for Phase 5.2J is `DRAFT -> APPROVED -> SUPERSEDED`. Older labels such as `PENDING_REVIEW` and `RETIRED` are superseded for active implementation docs. A corpus version under review is `DRAFT`; a replaced version is `SUPERSEDED`.

## New PostgreSQL Tables Required

| Table | Purpose |
|---|---|
| `LegalSource` | Registry of official source URLs and metadata |
| `LegalDocument` | Individual legal documents with identity, dates, relationships |
| `LegalDocumentChunk` | Structured legal text chunk with stable hierarchy metadata, xref metadata and ChromaDB record reference |
| `LegalCorpusVersion` | Immutable approved corpus snapshots |
| `LegalCorpusItem` | Which documents belong to which corpus version |
| `CorpusApprovalRecord` | Approval authority, date, scope, status |
| `RetrievalAuditLog` | Per-retrieval audit: query, scores, filters, results, timestamp |

## Consequences

- Legal corpus ingestion is on the critical path for A-to-Z acceptance.
- Internal Legal Operator must own source validation, corpus review, and approval process.
- Classification is blocked if corpus version is not approved or source is unavailable.
- A golden-path legal corpus fixture must be prepared for acceptance testing.

## Non-Claims

- This ADR does not confirm vbpl.vn or vanban.chinhphu.vn are technically accessible.
- This ADR does not define retrieval technology (see ADR-026).
- This ADR does not authorize formal legal reliability validation.
