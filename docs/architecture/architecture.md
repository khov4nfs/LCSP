# LCSP System Architecture

## Status

AUTHORITATIVE SYSTEM ARCHITECTURE

## Purpose

Define what LCSP components exist, why they exist, and how they communicate at system level. Implementation details such as RabbitMQ topology, database schema, retry policy, Node process packaging, exact framework wiring, and concrete queue payloads live in `docs/implementation/`.

## Architectural Style

```text
Web Frontend
-> NestJS API synchronous control plane
-> Python Worker Platform
-> Persistence / Legal Retrieval / Object Storage
```

LCSP is a modular, evidence-first compliance platform. The system is intentionally gate-driven: technical evidence, AIUsageFlow, reconciliation, VerifiedProfile, legal matching, classification, gap analysis, and document generation happen in sequence with explicit blocking conditions.

## Core Components

| Component                            | Why It Exists                                                                                                                                                                                                                                                         | Communicates With                                                                 |
| ------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Web Frontend                         | Manager workspace for assessment, repository connection, scan progress, conflict resolution, classification and documents; renders customer-facing auth and blocked-state copy from approved stable keys.                                                             | Backend API, shared contracts/i18n packages.                                      |
| Backend API                          | Auth, RBAC enforcement boundary, assessment state, synchronous user actions, trusted trigger creation, async work creation; emits safe auth/workspace error contracts with stable keys instead of relying on hardcoded user-facing prose.                             | Web Frontend, shared contracts packages, Persistence, Queue boundary, GitHub App. |
| Repository Integration               | Authorizes read-only repository access separately from OAuth/OIDC login.                                                                                                                                                                                              | Backend API, GitHub.                                                              |
| Python Worker Platform               | Owns all asynchronous domain workloads through bounded consumers/modules, not a monolithic Python process.                                                                                                                                                            | Queue boundary, Persistence, Object Storage, LLM Gateway, Repository Integration. |
| Python Scanner Worker                | Owns Repository Scan lifecycle and produces static-analysis technical evidence from commit-pinned repository snapshots using Syft, Knip, deptry, `ast`/`libcst`, bounded `ts-morph`, tree-sitter/custom parser, and Semgrep custom rules.                             | Queue boundary, Persistence, Repository Integration, TS/JS analyzer CLI.          |
| Python AIUsageFlow Worker            | Converts technical evidence and WizardProfile into business usage claims through a bounded LangGraph runtime that mixes deterministic evidence transforms with controlled LLM-assisted reasoning nodes.                                                               | Persistence, Reconciliation, LLM Gateway.                                         |
| Python Reconciliation Worker         | Compares Manager declarations and technical evidence; pauses for Manager resolution when needed; creates VerifiedProfile.                                                                                                                                             | Backend API, Persistence.                                                         |
| Python Legal Source Ingestion Worker | Fetches official legal sources, snapshots raw PDF/HTML into S3-compatible storage, normalizes legal structure, and stages corpus versions for review.                                                                                                                 | Queue boundary, Object Storage, Persistence.                                      |
| Corpus Review / Approval             | Internal Legal Operator gate that approves corpus versions before retrieval or classification can use them. This is an internal control function, not a new customer-facing product role.                                                                             | Backend API, Persistence, Audit, ChromaDB Legal Indexer.                          |
| Legal Corpus Store                   | Versioned, provenance-preserving legal corpus metadata, document chunks, source snapshots, approval records, corpus version pins and legal structure graph.                                                                                                           | Persistence, Object Storage, ChromaDB Legal Retriever.                            |
| ChromaDB Legal Indexer               | Builds a structure-first vectorless legal retrieval index for approved corpus versions: document/chunk storage, stable hierarchical IDs, metadata filters, full-text records, direct ID lookup and cross-reference graph metadata.                                    | Queue boundary, Persistence, ChromaDB, Legal Corpus Store.                        |
| ChromaDB Legal Retriever             | Retrieves citation-backed legal rules using full-text/metadata candidates, direct chunk/article lookup, parent-context assembly, one-hop cross-reference expansion and citation allowlist validation.                                                                 | ChromaDB Legal Index, Legal Matching, Retrieval Audit.                            |
| Citation Guardrail                   | Blocks or degrades legal matching, classification and documents when required citation/rule basis is missing or corpus version is not approved.                                                                                                                       | Legal Matching, Classification, Document Generation, Audit.                       |
| LLM Gateway                          | Central model boundary for real provider calls, prompt/template versions, schema validation, retries, model metadata and privacy enforcement. Mock mode is unit/offline-only and is not acceptance evidence.                                                          | AIUsageFlow, Classification, Document Generation, Persistence.                    |
| Python Legal Matching Worker         | Retrieves citation-backed legal rules for verified claims through the ChromaDB Legal Retriever and citation guardrails.                                                                                                                                               | ChromaDB Legal Retriever, Legal Corpus Store, Classification.                     |
| Python Classification Worker         | Classifies only from VerifiedProfile plus citation-backed legal matches.                                                                                                                                                                                              | Persistence, Gap Analysis.                                                        |
| Python Gap Analysis Worker           | Converts completed RiskClassification plus citation-backed legal matches into structured compliance gaps, evidence gaps, citation gaps and remediation priorities before document generation. Blocks document generation when classification/legal basis is unusable. | Queue boundary, Persistence, Document Generation.                                 |
| Python Document Worker               | Generates output documents only after classification, gap analysis, and output guardrails.                                                                                                                                                                            | Object storage, Persistence.                                                      |
| Audit                                | Records state-changing and compliance-critical actions without raw source/secrets/full prompts.                                                                                                                                                                       | All components.                                                                   |

### Phase 5.2L RAG Decision

The Project Owner approval condition `Update rag: chorma database (vector less)` is standardized as ChromaDB structure-first vectorless legal RAG.

```text
CHROMADB_STRUCTURE_FIRST_VECTORLESS_LEGAL_RAG_APPROVED
POSTGRESQL_PGVECTOR_LEGAL_RETRIEVAL_SUPERSEDED
LEGAL_STRUCTURE_PRESERVATION_REQUIRED
CROSS_REFERENCE_EXPANSION_REQUIRED
RETRIEVED_CITATION_ALLOWLIST_REQUIRED
NOT_BLOCKING_CANONICAL_UX_FLOW_DESIGN
```

LCSP MVP legal retrieval uses ChromaDB as a structure-first vectorless legal index. PostgreSQL pgvector, dense embedding indexes, and semantic nearest-neighbor retrieval are superseded as the mandatory legal corpus retrieval path. ChromaDB owns document/chunk records, stable IDs, metadata filtering, full-text matching, direct record lookup by ID/filter, and context retrieval through legal cross-reference graph metadata.

Legal retrieval units preserve legal hierarchy. The base retrieval unit is Clause (`Khoản`); Point (`Điểm`) content is assembled with parent Clause and Article context. Cross-referenced clauses/articles are expanded one hop and marked `context_role=REFERENCED_CONTEXT`. LLM/legal matching prompts may cite only chunks in the retrieved primary set or referenced-context allowlist.

## Communication Model

```text
User action or trusted integration trigger
-> API/trigger command
-> persisted domain object
-> async event/job
-> worker transformation
-> persisted output object
-> next event or blocked state
```

Each major stage persists its output before the next stage runs. Hidden synchronous jumps across workflow gates are not allowed.

## LangChain and LangGraph Runtime Boundary

LCSP's real business runtime may use LangChain and LangGraph inside the Python Worker Platform, but only as internal orchestration libraries behind the existing system boundaries.

```text
Queue event
-> worker-owned LangGraph state machine
-> deterministic evidence normalization / retrieval nodes
-> optional LLM-assisted reasoning nodes via LLM Gateway only
-> schema validation and guardrails
-> persisted artifact
-> next domain event or blocked/degraded state
```

Runtime rules:

- LangGraph graphs belong to bounded workers such as AIUsageFlow, Classification, and Document Generation. They do not replace the API, queue boundary, or persistence authority.
- LangChain components may be used for prompt composition, structured output parsing, and retrieval composition, but external provider calls still route only through the LLM Gateway.
- Deterministic evidence extraction, policy gates, citation allowlist checks, conflict gates, and artifact persistence remain authoritative outside model discretion.
- Graph state must be checkpointable, auditable, and idempotent per workflow run so retries, replay, and DLQ recovery do not create duplicate artifacts.
- Every model-assisted node must declare sanitized input schema, output schema, prompt/template version, retry policy, fallback behavior, and blocked/degraded semantics.
- Raw source, full prompts, secrets, and full AST bodies remain forbidden in graph state, gateway payloads, audit logs, and long-term persistence.
- If a graph cannot satisfy required evidence or citation gates, it must emit blocked/degraded outcomes instead of fabricating completion.

## Mandatory Architectural Invariants

- Manager can complete the active MVP flow without external collaborator assignment.
- RBAC is the authorization source of truth. Roles are subject attributes/templates only.
- OAuth/OIDC login is separate from GitHub App repository authorization.
- GitHub App read-only Repository Scan is the MVP golden technical-evidence path.
- `FR-050` is Automatic Trusted Scan Initiation. Local/CI scanner report upload is superseded.
- `FR-051` manual technical evidence JSON upload is removed from product scope.
- `FR-052` delegated technical clarification is Deferred/Post-MVP.
- Developer invitation/task collaboration is retired from the active MVP; Manager can complete the A-to-Z golden path without external collaborator participation.
- Structured attestation is `SUPERSEDED_FOR_ACTIVE_MVP`.
- Scanner is static-analysis only.
- Scanner toolchain outputs are evidence only and never legal truth, classification truth, proof of active AI use, or proof of automated decision-making.
- Raw source, full prompts, secrets, and full AST bodies must not enter LLM, ordinary audit logs, or long-term persistence.
- Classification requires VerifiedProfile.
- Missing citation, unresolved conflict, insufficient evidence, or unknown critical usage blocks or degrades output.
- Provider/model/framework detection alone does not determine legal risk.
- Real LLM integration requires explicit provider/model configuration, credentials, token/cost controls and privacy boundaries. Dense embedding provider/model configuration is not required for legal corpus retrieval in the vectorless MVP.
- Legal-source use requires official-source validation, immutable snapshot, content hash, approval gate and approved `LegalCorpusVersion`.
- Shared app/package imports must use approved public exports; direct workspace source-path imports, disallowed relative workspace imports, and self-import patterns that bypass public exports are forbidden.
- Auth and blocked-state shared contracts must remain type-checked across Web/API boundaries.

## Detail Ownership

| Detail                           | Canonical Location                                                                           |
| -------------------------------- | -------------------------------------------------------------------------------------------- |
| Domain behavior                  | `docs/specs/`                                                                                |
| Runtime traces                   | `docs/specs/domain-state-machines.md`, `docs/specs/event-catalog.md`, `docs/implementation/` |
| Technology/library/build details | `docs/implementation/`                                                                       |
| Historical decisions             | git history                                                                                  |

## Open Technical Decisions

- RBAC engine, policy storage, cache, invalidation, evaluation topology and failure behavior: resolved for implementation planning by `docs/implementation/decisions/rbac-runtime-decision.md`.
- Automatic trusted scan trigger idempotency, retry/DLQ, replay authority and operator recovery: resolved for implementation planning by `docs/implementation/decisions/trusted-scan-trigger-retry-dlq-replay-decision.md`.
- Scanner toolchain failure severity table and tool version/config/ruleset hash policy: resolved for implementation planning by `docs/implementation/decisions/scanner-severity-tool-provenance-decision.md`.
