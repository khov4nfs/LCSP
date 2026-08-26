# LCSP Architecture Decision Records

## Purpose

This document is the active ADR authority index for the A-to-Z runnable MVP. Detailed decisions live in individual ADR files. Historical reasoning remains in git history, not active implementation or UX authority.

## Current Architecture Direction

```text
Modular NestJS API synchronous control plane
+ Python Worker Platform for all asynchronous domain workloads
+ bounded Node.js TS/JS analyzer CLI only
+ PostgreSQL/Prisma for primary persistence
+ ChromaDB structure-first vectorless legal retrieval
+ RabbitMQ/outbox
+ S3-compatible object storage
+ real LLM provider for A-to-Z acceptance; embeddings are not required for legal retrieval MVP
```

The system uses deterministic orchestration, state machines, evidence gates, and bounded workers. It does not use free-form autonomous agents to bypass domain rules.

## Status Legend

| Status                 | Meaning                                                  |
| ---------------------- | -------------------------------------------------------- |
| Accepted               | Active MVP constraint                                    |
| Accepted — Superseding | Active decision that replaces part/all of an earlier ADR |
| Partially Superseded   | Retained only for portions not replaced by a newer ADR   |
| Deferred               | Not active MVP authority                                 |
| Historical             | Evidence only; not implementation authority              |

## Authority and Supersession Rules

1. Newer explicit supersession notes override older conflicting wording.
2. ADR-023 overrides TypeScript-first scanner lifecycle ownership in ADR-002/ADR-022.
3. ADR-024 overrides mock-LLM-as-default happy-path wording.
4. ADR-025 overrides local JSONL corpus seed as the legal source architecture.
5. ADR-026 overrides pgvector, embedding-index, hybrid-vector and unspecified legal retrieval wording for MVP.
6. Product scope and canonical requirements remain governed by PRD, FR/NFR catalogs, and Project Owner decisions propagated into active docs.
7. Phase 5.2L supersedes older wording: RBAC replaces RBAC, structured attestation is removed from active MVP, `FR-050` is Automatic Trusted Scan Initiation, `FR-051` is removed from product scope, and Node.js downstream workers are superseded.

## Active Decision Summary

| ADR              | Active Decision                                                                                                            | Status                                                                                                  |
| ---------------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| ADR-001          | Modular monolith-first API boundary with extractable modules                                                               | Accepted                                                                                                |
| ADR-002          | Async worker workloads remain outside synchronous API lifecycle                                                            | Partially Superseded: scanner runtime wording replaced by ADR-023; downstream async separation retained |
| ADR-003          | Manager-led workflow; Developer invitation/task retired from active MVP                                                    | Accepted                                                                                                |
| ADR-004          | Evidence-first classification gate                                                                                         | Accepted                                                                                                |
| ADR-005          | GitHub App Repository Scan is the only active MVP evidence path; Local/CI/manual uploads deferred                          | Superseded by Phase 5.2L for `FR-050`/`FR-051` semantics                                                |
| ADR-006          | No raw source to LLM and no long-term raw source persistence                                                               | Accepted                                                                                                |
| ADR-007          | Binary unresolved-conflict routing; scores are explanatory only                                                            | Accepted                                                                                                |
| ADR-008          | Structured technical attestation is supplemental only and cannot unlock classification                                     | `SUPERSEDED_FOR_ACTIVE_MVP`                                                                             |
| ADR-009          | Deterministic orchestration and state-machine-controlled worker chaining                                                   | Accepted                                                                                                |
| ADR-010          | GitHub App read-only repository evidence path                                                                              | Accepted                                                                                                |
| ADR-011..ADR-021 | Existing active technical/security/queue/evidence decisions                                                                | Retained unless explicitly superseded below                                                             |
| ADR-022          | TypeScript-first non-scanner stack and prototype boundaries                                                                | Superseded for downstream domain workers by Phase 5.2L                                                  |
| ADR-023          | Python Worker owns Repository Scan; Poetry, `ast` + `libcst`, Node subprocess for TS/JS                                    | Accepted — Superseded in part by expanded Phase 5.2L scanner toolchain                                  |
| ADR-024          | Real configured LLM provider mandatory for A-to-Z acceptance; mock test/offline only                                       | Accepted — Superseding                                                                                  |
| ADR-025          | Provenance-preserving official-source legal corpus with internal approval and immutable versioning                         | Accepted — Superseding                                                                                  |
| ADR-026          | ChromaDB structure-first vectorless legal retrieval with legal hierarchy, xref expansion and citation allowlist validation | Accepted — Superseding                                                                                  |

## Clarified ADR-002 Runtime Boundary

The active decision is:

```text
NestJS API handles synchronous HTTP, RBAC enforcement boundary, job/trigger creation, and query surfaces.
Python Worker Platform owns all asynchronous domain workloads.
Python Scanner Worker owns Repository Scan lifecycle.
Bounded Node.js CLI owns only TS/JS `ts-morph` analyzer adaptation invoked by Python Scanner Worker.
```

Any older statement that the controlled MVP scanner worker is TypeScript-first is historical and superseded.

## Clarified ADR-003 / ADR-008 Collaboration Boundary

- Manager is required and sufficient for the active MVP golden path.
- Developer invitation/task workspace is retired from the active MVP.
- Structured attestation under `FR-045/FR-046` is `SUPERSEDED_FOR_ACTIVE_MVP`.
- Reintroduction requires a new scope decision and cross-layer contract.
- Delegated free-form technical clarification under `FR-052` is Deferred and must not become an active UX route.

## Legal Operations UX Boundary

ADR-025 corpus source validation, review, approval, and index-build actions are performed by an Internal Legal Operator through internal API/CLI for MVP. They are not Manager customer-facing UX scope. A dedicated legal-operations web console requires a future scope decision.

## Locked Technical Profiles

### Scanner

```text
Python 3.11+
Poetry / pyproject.toml
ast + libcst
Syft SBOM/dependency inventory
Knip JS/TS dependency usage
deptry Python dependency usage
Semgrep custom AI rules
tree-sitter/custom parser structural augmentation
Python-native scan-local graph
Node ts-morph subprocess with JSON stdio
metadata-only PostgreSQL persistence
cleanup-verified terminal event
```

### Authorization

```text
RBAC source of truth
roles as subject attributes/templates only
deny-by-default
tenant-scoped
server-side enforced
versioned/auditable decisions
engine/storage/cache/invalidation/topology/failure behavior: resolved by docs/implementation/decisions/rbac-runtime-decision.md
```

### LLM

```text
provider mode required for integrated/A-to-Z acceptance
mock mode limited to unit tests, offline CI, credential-unavailable component development
sanitized structured inputs only
schema validation + timeout/retry + audit + budget controls
```

### Legal Retrieval

```text
validated official-source snapshots
approved immutable LegalCorpusVersion
ChromaDB structure-first vectorless legal index
Clause-level base retrieval unit
metadata and full-text candidate retrieval
direct chunk/article lookup
one-hop cross-reference expansion
parent-context assembly
corpus/effective-date/source/metadata filters
citation reconstruction and retrieval audit
retrieved citation allowlist validation
```

## Non-Claims

- This index does not authorize implementation or production deployment.
- It does not certify legal reliability or compliance.
- It does not replace individual ADR detail where no conflict exists.
- Current planning status remains UX pending and story traceability pending.
