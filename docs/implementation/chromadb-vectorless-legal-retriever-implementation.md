# ChromaDB Vectorless Legal Retriever Implementation Specification

> **Historical pre-freeze documentation.** This document records the earlier design or implementation. Current architecture authority is [the canonical Architecture Freeze](../../reports/architecture-freeze-migration-manifest.md); current runtime names and release status must be read there and in the current PR #367 receipts.

## Status

AUTHORITATIVE — A-to-Z Runnable MVP

## Purpose

Define ChromaDB structure-first vectorless legal retrieval, stable legal hierarchy IDs, metadata filtering, full-text candidate matching, direct ID lookup, one-hop cross-reference expansion, parent-context assembly, citation allowlist validation, privacy, and retrieval auditing for legal matching.

## Active References

- `docs/architecture/adr/adr-026-chromadb-vectorless-legal-retriever.md`
- `docs/specs/legal-matching-domain-spec.md`
- `docs/specs/legal-corpus-source-spec.md`
- `docs/implementation/persistence-implementation.md`
- `docs/implementation/queue-implementation.md`

## Locked MVP Retrieval Profile

| Concern | Value |
|---|---|
| Retrieval store | ChromaDB |
| Dense embeddings | Not required for legal retrieval MVP |
| Primary retrieval method | Full-text/metadata candidate retrieval plus direct ID lookup |
| Base retrieval unit | Clause (`Khoản`) |
| Point handling | Assemble with parent Clause and Article context |
| Cross-reference handling | One-hop expansion with `context_role=REFERENCED_CONTEXT` |
| Citation safety | Allowlist built from retrieved primary and referenced-context chunks |
| Corpus | Approved immutable version pinned to assessment |

## Stable IDs

```text
{document_id}::art-{article_no}
{document_id}::art-{article_no}::cl-{clause_no}
{document_id}::art-{article_no}::cl-{clause_no}::pt-{point_code}
```

IDs are stable inside a LegalCorpusVersion. Amended content creates a new chunk and links to the previous chunk with `supersedes_chunk_id`.

## Minimum Chroma Metadata

```text
corpus_version_id
doc_id
document_number
document_title
document_type
issuing_authority
article_id
article_number
article_title
clause_id
clause_number
point_id
point_code
hierarchical_path
effective_from
effective_to
legal_status
source_effect_status
source_url
source_checksum
chunk_checksum
outgoing_ref_ids
incoming_ref_ids
supersedes_chunk_id
repealed_by_ref
```

`legal_status` values: `ACTIVE | AMENDED | REPEALED`. A chunk is `REPEALED` either by a new version of the same provision (`supersedes_chunk_id`, same document lineage) or by a locator-level repeal clause in a different document (`repealed_by_ref = {document_id, locator}`, cross-document — see `legal-corpus-source-spec.md`). Candidate retrieval excludes `REPEALED` chunks unless the query explicitly requests historical context.

`source_effect_status` is the document-level registry status (see `legal-corpus-source-spec.md` Source Effect Status), denormalized onto every chunk of the document so Chroma metadata filters can apply it. It is orthogonal to chunk-level `legal_status`: a suspended document (`NGUNG_HIEU_LUC`) keeps its chunks `ACTIVE` but the whole document is excluded from default retrieval scope.

## Candidate Retrieval

Every query applies:

1. approved corpus version pinned to the assessment;
2. effective-date interval at assessment date;
3. validated source status;
4. document-level `source_effect_status` scope (`NGUNG_HIEU_LUC`, `HET_HIEU_LUC_TOAN_BO`, `KHONG_CON_PHU_HOP` excluded unless historical context is explicitly requested);
5. optional document type, issuing authority, article, clause, point and source-tier filters;
6. supersession relationships inside the pinned corpus, including cross-document locator-level repeal (`legal_status != REPEALED` unless historical context is explicitly requested);
7. citation reconstruction completeness.

Candidate retrieval may use full-text matching, metadata filters, known legal IDs, or a combination of those. It must not require dense embedding generation or vector similarity to select legal clauses.

## Context Assembly

Every retrieval payload distinguishes:

```text
PRIMARY_MATCH
PARENT_CONTEXT
REFERENCED_CONTEXT
```

If the primary match is a Point, include its parent Clause and Article context. If the primary match is a Clause, include Article title/number and document title. If the primary match references another provision, fetch the referenced provision one hop and mark it as `REFERENCED_CONTEXT` with reason metadata.

Referenced context must not be presented as the primary hit.

## Citation Allowlist

`LegalRuleMatch` and downstream LLM prompts receive a citation allowlist built from:

- `retrieved_chunks`;
- `referenced_context_chunks`;
- parent context required to interpret the primary legal unit.

Any `legal_ref` outside the allowlist is rejected. The system never synthesizes legal citations.

## Retrieval Privacy

Retriever queries are derived from structured VerifiedProfile/AIUsageFlow labels and exclude raw repository source, credentials, full prompts, unnecessary personal free text, and unredacted logs.

`RetrievalAuditLog` stores sanitized query terms/facets, query hash, corpus/date/metadata filters, matched IDs, context roles, result count, correlation ID, and timestamp. It does not store arbitrary raw query text that may contain customer-sensitive content.

## Canonical Index Build Workflow

```text
LegalCorpusVersion APPROVED
-> command.legal-index-build.requested.v1
-> load approved legal hierarchy
-> verify stable IDs and checksums
-> extract cross-reference edges
-> write ChromaDB records and metadata
-> validate direct lookup, metadata filters and full-text candidate retrieval
-> event.legal-index-build.completed.v1
```

Failure publishes `event.legal-index-build.failed.v1`, leaves the corpus unavailable for legal matching, and exposes an actionable audited state.

## Failure Behavior

| Condition | Behavior |
|---|---|
| Corpus not approved | block retrieval |
| Source not validated | exclude source and block if required basis is unavailable |
| ChromaDB unavailable | block required legal retrieval |
| Missing legal structure metadata | fail index build |
| Missing cross-reference target | index with coverage limitation or block when referenced context is mandatory |
| Unresolved locator in a repeal clause (`repealed_locators` entry does not map to a chunk in the target document) | fail index build for that relationship; do not mark target chunk `REPEALED` on a guess |
| Zero candidates | do not claim applicability; block/degrade classification by rule criticality |
| Citation cannot be reconstructed | reject candidate |
| Citation outside allowlist | reject output and block/degrade according to rule criticality |
| Effective date mismatch | exclude candidate |

## Audit and Cost Controls

- Record corpus version, source/chunk checksums, context roles, candidate IDs and result counts.
- Enforce LLM monthly token/cost caps under `NFR-033`; legal retrieval itself does not require embedding cost controls.
- Record only sanitized query metadata and result references.
- Reproduce retrieval from corpus version, index profile, query hash, filters, legal IDs and ChromaDB collection version.

## Acceptance

- Retrieval uses approved corpus, date, source and metadata filters.
- Results reconstruct article/clause/point-level citations.
- Primary, parent and referenced context are distinguishable.
- Raw source and sensitive customer text are absent from retrieval/audit payloads.
- Missing index, missing citation or out-of-allowlist citation fails closed.
- `FR-053`, `FR-054`, and `FR-056` retain canonical `NFR-017` and `NFR-034` dependencies.
