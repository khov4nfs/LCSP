# ADR-026 — ChromaDB Structure-First Vectorless Legal Retriever

> **Historical pre-freeze documentation.** This document records the earlier design or implementation. Current architecture authority is [the canonical Architecture Freeze](../../../reports/architecture-freeze-migration-manifest.md); current runtime names and release status must be read there and in the current PR #367 receipts.

## Status

Accepted — Superseding

## Decision Context

```text
PROJECT_OWNER_LOCKED
CHROMADB_STRUCTURE_FIRST_VECTORLESS_LEGAL_RAG_APPROVED
POSTGRESQL_PGVECTOR_LEGAL_RETRIEVAL_SUPERSEDED
LEGAL_STRUCTURE_PRESERVATION_REQUIRED
CROSS_REFERENCE_EXPANSION_REQUIRED
RETRIEVED_CITATION_ALLOWLIST_REQUIRED
```

## Decision

LCSP MVP uses ChromaDB as the legal retrieval index for a structure-first, vectorless legal RAG pipeline.

The active MVP legal retrieval path does not use PostgreSQL pgvector, dense embedding indexes, or semantic nearest-neighbor retrieval as the primary source of legal clause selection.

ChromaDB is used for:

- document/chunk storage;
- stable hierarchical IDs;
- metadata filtering;
- full-text matching;
- direct record lookup by chunk/article ID;
- retrieval of referenced legal context by stored cross-reference graph metadata.

## Supersession

```text
PGVECTOR_PLUS_POSTGRESQL_FTS_SUPERSEDED
EMBEDDING_INDEX_NOT_REQUIRED_FOR_LEGAL_RETRIEVAL_MVP
SEMANTIC_NEAREST_NEIGHBOR_NOT_PRIMARY_LEGAL_CLAUSE_SELECTION
```

Any previous active wording that requires PostgreSQL `vector(1536)`, pgvector HNSW, embedding generation, vector similarity scores, or `0.4 FTS + 0.6 vector` hybrid ranking for legal corpus retrieval is superseded.

BGE-M3 or any other embedding model may be considered later as an optional reranker or semantic retrieval model. It is not an MVP legal retrieval dependency.

## Architecture

```text
Official legal source
-> immutable source snapshot
-> checksum
-> legal structure parser
-> document/article/clause/point hierarchy
-> cross-reference extraction
-> cross-document locator-level repeal resolution
-> effective-date/version resolution
-> approved LegalCorpusVersion
-> ChromaDB document + metadata index
-> full-text/metadata candidate retrieval
-> direct chunk/article lookup when applicable
-> one-hop reference expansion
-> parent-context assembly
-> retrieved citation allowlist validation
-> LegalRuleMatch
```

## Legal Structure Rules

| Concern | Canonical Rule |
|---|---|
| Base retrieval unit | Clause (`Khoản`). Do not split inside a sentence or clause only to satisfy token size. |
| Point context | Point (`Điểm`) content is assembled with parent Clause and Article context. |
| Article context | Every retrieved unit carries document title, article number/title and clause number where applicable. |
| Cross-reference | Ingestion creates xref edges. When X is retrieved, referenced Y is included one hop as `context_role=REFERENCED_CONTEXT`. |
| Stable identity | Chunks use stable hierarchical IDs and metadata: `doc_id`, `article_id`, `clause_id`, `point_id`. |
| Effective law | New assessments do not retrieve expired/superseded text unless the pinned corpus/effective date requires historical context. |
| Cross-document repeal | A chunk's `legal_status` can be set to `REPEALED` by a locator-level repeal clause in a *different* document (e.g. a later law's "điều khoản thi hành" bãi bỏ specific khoản/điểm/chapter of an earlier law). This is distinct from `supersedes_chunk_id` (same-document version lineage) — repealed chunks carry `repealed_by_ref` pointing to the repealing document/locator instead. Repeal is locator-scoped: the rest of the target document remains `ACTIVE` and retrievable. |
| Citation safety | `legal_ref` is valid only when it points to a chunk in `retrieved_chunks` or `referenced_context_chunks`. |

## Stable ID Pattern

```text
{document_id}::art-{article_no}
{document_id}::art-{article_no}::cl-{clause_no}
{document_id}::art-{article_no}::cl-{clause_no}::pt-{point_code}
```

Example:

```text
LAW-2025-001::art-12::cl-3::pt-b
```

IDs are stable inside a legal corpus version. Amended content creates new versioned chunks and links to prior chunks through `supersedes_chunk_id`; history is not overwritten.

## Minimum Metadata

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
source_url
source_checksum
chunk_checksum
outgoing_ref_ids
incoming_ref_ids
supersedes_chunk_id
repealed_by_ref
```

`legal_status` values: `ACTIVE | AMENDED | REPEALED`. `repealed_by_ref` (`{document_id, locator}`) is populated only when `legal_status = REPEALED` via a cross-document locator-level repeal (see `legal-corpus-source-spec.md` Document Relationship Schema); it is null for same-document amendment lineage, which uses `supersedes_chunk_id` instead.

## Assembly Contract

Every retrieval payload distinguishes:

```text
PRIMARY_MATCH
PARENT_CONTEXT
REFERENCED_CONTEXT
```

Referenced context must not be presented as the primary hit. It keeps its own provenance, effective-date metadata and reason, such as `referenced by Clause 3 Article 12`.

## Citation Allowlist

Legal matching and LLM calls receive a citation allowlist built from:

- `retrieved_chunks`;
- `referenced_context_chunks`;
- parent context required to interpret a point/clause.

Any `legal_ref` outside that allowlist is rejected. The system never synthesizes a legal citation.

## Fail-Closed Behavior

Classification is blocked or explicitly degraded according to rule criticality when:

- required corpus version is not approved;
- required source is unvalidated/unavailable;
- ChromaDB index is unavailable;
- no candidate can support a required rule;
- required citation fields cannot be reconstructed;
- effective-date/corpus-version filters exclude the legal basis;
- an LLM or rule output cites a chunk outside the retrieved allowlist.

## Consequences

- PostgreSQL remains the primary relational persistence store, but PostgreSQL pgvector is not required for legal retrieval.
- ChromaDB stores legal retrieval documents/chunks with hierarchical IDs and metadata.
- Legal source ingestion must preserve document/article/clause/point structure and cross-reference edges.
- `NFR-017` governs legal citation/version traceability.
- `NFR-034` governs immutable approved corpus versions.
- `NFR-033` governs LLM token/cost controls; embedding cost controls are future-only unless a later approved semantic/reranker path is added.

## Non-Claims

- Retrieval does not make legal conclusions.
- Corpus approval is not legal certification.
- ChromaDB/vectorless retrieval does not remove citation, effective-date, source validation, corpus-version or fail-closed requirements.
- Optional future embeddings, rerankers, or semantic retrieval require a separate approved decision.
