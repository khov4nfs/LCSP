# LCSP Requirements Traceability Summary

> **Historical pre-freeze documentation.** This document records the earlier design or implementation. Current architecture authority is [the canonical Architecture Freeze](../../reports/architecture-freeze-migration-manifest.md); current runtime names and release status must be read there and in the current PR #367 receipts.

## Purpose

Summarize canonical requirement and planning traceability after Phase 5.2L and the approved 2026-11-24 Prompt 8 course correction. This document supports planning and contract RED-test design but does not authorize production debit by itself.

## Canonical Inventory

| Item                     | Count / Status                                                                                                                   |
| ------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Canonical FR total       | 68 (`FR-001..FR-056`, `FR-083..FR-094`)                                                                                          |
| Active MVP FR total      | Active set includes `FR-050` trusted scan plus Prompt 8 `FR-083..FR-094`; retired/superseded/removed rows remain historical only |
| Removed / superseded FRs | `FR-007`, `FR-008`, `FR-010`, `FR-011`, `FR-047` retired; `FR-045`, `FR-046` superseded; `FR-051` removed                        |
| Deferred FR total        | `FR-052` delegated clarification remains deferred                                                                                |
| Active NFR total         | 40 (`NFR-001..NFR-030`, `NFR-033..NFR-042`)                                                                                      |
| AC total                 | 60 (`AC-001..AC-041`, `AC-050A..AC-050F`, `AC-051..AC-063`)                                                                      |
| Canonical use cases      | `UC-001..UC-017`, `UC-019..UC-024`; `UC-018` structured attestation superseded                                                   |
| Canonical UX             | rebased assessment UX plus Prompt 8 overlay in `docs/planning-artifacts/ux-designs/ux-LCSP-2026-11-24-shared-wallet/` and canonical UX review |
| Canonical epics/stories  | `docs/planning-artifacts/epics.md`                                                                                               |
| Story traceability       | created / assessable via `docs/test-artifacts/traceability/implementation-readiness-traceability-2026-06-25.md`                  |

`NFR-031` and `NFR-032` are legacy aliases of active `NFR-005` and `NFR-008`. PRD `FR-E*` values and legacy `UC-MXX-XX` values are source aliases only.

## Active Scope

- RBAC is the authorization source of truth; roles are attributes/templates only.
- GitHub App read-only Repository Scan is the golden technical-evidence path.
- `FR-050` automatically creates or resumes scan workflows from trusted integration context.
- Python Worker Platform owns all asynchronous domain workloads.
- Repository analysis uses native Deep Agents with LCSP Docker sandbox tools and optional Codebase Memory MCP; direct repository source is the evidence authority.
- Real LLM provider configuration is required for A-to-Z acceptance; dense embedding providers are not required for legal retrieval MVP.
- Legal corpus uses validated official-source snapshots, internal approval, immutable versioning, and ChromaDB structure-first vectorless retrieval with legal hierarchy, xref expansion and citation allowlist validation.
- Manager can complete the golden path without external collaborator participation.
- Structured attestation is `SUPERSEDED_FOR_ACTIVE_MVP`.
- Local/CI scanner report upload is superseded by `FR-050`.
- Manual evidence JSON (`FR-051`) is `REMOVED_FROM_PRODUCT`.
- Delegated free-form clarification (`FR-052`) is Deferred/Post-MVP.
- Organization creation/membership and organization-scoped authorization are retired; active authorization is owner/resource-scoped RBAC.
- Prompt 8 adds one shared prepaid wallet per customer, immutable direct-credit pricing, per-invocation admission/settlement, payment-required/manual Continue, charge history, reconciliation and compensation.
- Pricing Draft defaults are FX `26,500 VND/USD`, infrastructure overhead `10%`, and markup `1.8`; they are editable planning assumptions rather than runtime formula constants or approved universal tariffs.
- Customer transaction tax is separated at checkout/invoice and never becomes spendable credit.
- Production debit remains disabled until gates `G-01..G-07` in the PRD Addendum satisfy their measurable exit conditions, evidence and named approvals.

## UX Boundary

UX must be rebased or regenerated from the pruned active authority set. The next UX artifact must cover:

- Manager authentication, owner-scoped assessment, Wizard, repository, scan, evidence, reconciliation, classification, gap, document, and audit experiences;
- customer wallet, top-up, outstanding usage, charge history, payment-required and manual Continue experiences;
- Admin Model Pricing, immutable publish, unknown usage, billing-integrity review and bounded compensation experiences;
- Developer invitation/task experiences are retired; evidence views remain redacted without structured attestation;
- all loading, empty, permission-denied, insufficient, blocked, failed, retry, rerun, degraded, and audit-reference states.

It must not design active customer-facing flows for:

- manual scanner report upload, `FR-051`, `FR-052`, and structured attestation;
- corpus source ingestion, review, approval, or index administration;
- production administration outside active MVP scope.
- paid-tool billing or organization/Developer management.

Internal Legal Operator corpus administration remains API/CLI-only for MVP. Manager UX may display assessment-relevant corpus version and citation provenance only.

## Story Dependency Carry-Forward

| FR     | Required story-layer NFR dependencies |
| ------ | ------------------------------------- |
| FR-053 | NFR-017, NFR-034                      |
| FR-054 | NFR-017, NFR-034                      |
| FR-055 | NFR-012, NFR-033                      |
| FR-056 | NFR-017, NFR-033, NFR-034             |
| FR-083 | NFR-036..NFR-039                      |
| FR-084 | NFR-037, NFR-038                      |
| FR-085 | NFR-036, NFR-037, NFR-039             |
| FR-086 | NFR-038                               |
| FR-087 | NFR-036                               |
| FR-088 | NFR-038, NFR-040                      |
| FR-089 | NFR-036..NFR-038                      |
| FR-090 | NFR-022, NFR-037                      |
| FR-091 | NFR-027, NFR-041                      |
| FR-092 | NFR-037, NFR-041                      |
| FR-093 | NFR-037, NFR-038                      |
| FR-094 | NFR-033, NFR-042                      |

Every story must trace to canonical UC, FR, AC, relevant NFRs, UX flow/state, domain state, implementation area, and failure/recovery behavior.

## Status

```text
CONSOLIDATION_PASS_APPLIED
CANONICAL_USE_CASES_NORMALIZED
CANONICAL_ACCEPTANCE_CRITERIA_NORMALIZED
LEGAL_CORPUS_UX_BOUNDARY_LOCKED
PYTHON_WORKER_PLATFORM_IMPLEMENTATION_CONSOLIDATED
SCANNER_BEHAVIOR_AUTHORITY_CONSOLIDATED
RBAC_AUTHORIZATION_MODEL_ALIGNED
FR_050_AUTOMATIC_TRUSTED_SCAN_INITIATION_TRACED
FR_051_REMOVED_FROM_PRODUCT
STRUCTURED_ATTESTATION_SUPERSEDED_FOR_ACTIVE_MVP
PROJECT_OWNER_DOC_REMEDIATION_APPROVED
UX_REBASED_ACTIVE_DOC_SET
PYTHON_WORKER_PACKAGE_TOPOLOGY_LOCKED
AUDIT_EXPORT_SYNC_API_BOUNDARY_LOCKED
UX_REBASE_COMPLETE_AFTER_DOC_PRUNING
CHROMADB_VECTORLESS_DOMAIN_CONTRACT_ALIGNED
CHROMADB_STRUCTURE_FIRST_VECTORLESS_LEGAL_RAG_APPROVED
POSTGRESQL_PGVECTOR_LEGAL_RETRIEVAL_SUPERSEDED
STORY_TRACEABILITY_CREATED
STORY_COVERAGE_ASSESSABLE
CANONICAL_EPICS_AND_STORIES_ARTIFACT_PRESENT
PROMPT_8_PRODUCT_AUTHORITY_ADDED
ORGANIZATION_SCOPE_RETIRED_FROM_ACTIVE_MVP
PROMPT_8_ARCHITECTURE_UX_EPIC_REBASE_REQUIRED
CONTRACT_RED_TEST_DESIGN_AUTHORIZED
PRODUCTION_MODEL_USAGE_DEBIT_NOT_AUTHORIZED
```
