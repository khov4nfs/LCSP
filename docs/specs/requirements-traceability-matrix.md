# LCSP Requirements Traceability Matrix

## Purpose

Canonical traceability from use cases to requirements, acceptance criteria, domain/state specifications, and implementation areas.

## Inventory

| Item                    | State                                                                                                                                                               |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Canonical use cases     | UC-001..UC-017; historical UC-018 superseded                                                                                                                        |
| Functional requirements | 56 total; Phase 5.2L: `FR-050` active Automatic Trusted Scan Initiation; `FR-051` removed; `FR-052` deferred; `FR-045/FR-046` superseded                            |
| Active NFRs             | 33                                                                                                                                                                  |
| Acceptance criteria     | AC-001..AC-041 plus AC-050A..AC-050F                                                                                                                                |
| UX                      | active rebased UX in `docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/` plus canonical review                                                                 |
| Stories                 | `docs/planning-artifacts/epics.md`; implementation-readiness traceability in `docs/test-artifacts/traceability/implementation-readiness-traceability-2026-06-25.md` |

Legacy `UC-MXX-XX`, `FR-E*`, `FR-057..FR-082`, `NFR-031`, and `NFR-032` are aliases/history only. Active rows below use canonical identifiers.

## Functional Traceability

| FR     | UC                                     | AC                             | Domain / State Source                      | Implementation Area                        |
| ------ | -------------------------------------- | ------------------------------ | ------------------------------------------ | ------------------------------------------ |
| FR-001 | UC-001                                 | AC-021                         | domain model / identity policy             | API Identity                               |
| FR-002 | UC-001                                 | AC-021                         | identity/session policy                    | API Identity                               |
| FR-003 | UC-001                                 | AC-021                         | identity/session policy                    | API Identity                               |
| FR-004 | UC-001                                 | AC-021, AC-022                 | identity/session policy                    | API Identity                               |
| FR-005 | UC-001                                 | AC-021, AC-023                 | OAuth policy                               | API Identity                               |
| FR-006 | UC-001, UC-005                         | AC-023                         | user task flows                            | Identity + Repository API                  |
| FR-007 | UC-002                                 | AC-024                         | domain model                               | Organization API                           |
| FR-008 | UC-002                                 | AC-024                         | domain model                               | Organization API                           |
| FR-009 | UC-002                                 | AC-024                         | RBAC subject attributes/templates          | RBAC                                       |
| FR-010 | —                                      | —                              | `RETIRED_FROM_ACTIVE_MVP`                  | no active implementation                   |
| FR-011 | —                                      | —                              | `RETIRED_FROM_ACTIVE_MVP`                  | no active implementation                   |
| FR-012 | UC-002, UC-010, UC-011, UC-013, UC-014 | AC-025, AC-026                 | RBAC guards                                | RBAC                                       |
| FR-013 | UC-003                                 | AC-001                         | Assessment state                           | Assessment API                             |
| FR-014 | UC-004                                 | AC-002                         | WizardProfile / Assessment                 | Wizard API/UI                              |
| FR-015 | UC-004, UC-014                         | AC-003                         | system context / document spec             | Assessment UI                              |
| FR-016 | UC-005                                 | AC-004, AC-023                 | repository connection state                | GitHub API                                 |
| FR-017 | UC-006                                 | AC-004, AC-020                 | RepositorySnapshot                         | GitHub API                                 |
| FR-018 | UC-007, UC-016                         | AC-004, AC-028, AC-029         | ScanJob / scanner spec                     | API + Python Worker                        |
| FR-019 | UC-007, UC-017                         | AC-005, AC-022, AC-029, AC-030 | scanner spec / ScanJob                     | Python Worker Security                     |
| FR-020 | UC-007, UC-008                         | AC-005                         | TechnicalEvidenceReport                    | Evidence Gates                             |
| FR-021 | UC-008                                 | AC-006                         | report state machine                       | Evidence Gates                             |
| FR-022 | UC-008                                 | AC-007                         | TechnicalProfile                           | Technical Profile Worker                   |
| FR-023 | UC-007, UC-008, UC-009                 | AC-007, AC-031, AC-032         | scanner + AIUsageFlow specs                | Python/AIUsage Workers                     |
| FR-024 | UC-009                                 | AC-008                         | AIUsageFlow                                | AI Usage Flow Worker                       |
| FR-025 | UC-009                                 | AC-009, AC-031, AC-032         | AIUsageFlow state                          | AI Usage Flow Worker                       |
| FR-026 | UC-010                                 | AC-010, AC-033                 | conflict state                             | Reconciliation Worker                      |
| FR-027 | UC-010                                 | AC-011                         | reconciliation spec                        | Reconciliation Worker                      |
| FR-028 | UC-010                                 | AC-012, AC-033                 | conflict state                             | Reconciliation API                         |
| FR-029 | UC-010                                 | AC-012, AC-033                 | conflict state                             | Reconciliation API                         |
| FR-030 | UC-011                                 | AC-014, AC-015                 | AIUsageFlow/evidence context               | EngineeringRule Assessment                 |
| FR-031 | UC-011                                 | AC-015                         | retired VerifiedProfile approval gate      | Classification API/UI                      |
| FR-032 | UC-012                                 | AC-016, AC-035, AC-036         | legal corpus state                         | Legal Corpus / EngineeringRule Compiler    |
| FR-033 | UC-012                                 | AC-016, AC-036                 | EngineeringRule spec                       | EngineeringRule Assessment                 |
| FR-034 | UC-012, UC-013                         | AC-017, AC-034, AC-036         | EngineeringRule/classification state       | EngineeringRule Assessment                 |
| FR-035 | UC-013                                 | AC-016, AC-018, AC-037, AC-038 | classification state                       | EngineeringRule Assessment                 |
| FR-036 | UC-013                                 | AC-017, AC-018, AC-034         | classification state                       | EngineeringRule Assessment                 |
| FR-037 | UC-013                                 | AC-018                         | classification spec                        | Classification API/UI                      |
| FR-038 | UC-014                                 | AC-018                         | GapAnalysis state                          | Gap Analysis Worker                        |
| FR-039 | UC-014                                 | AC-018, AC-019, AC-027, AC-041 | document state                             | Document Worker                            |
| FR-040 | UC-004, UC-014                         | AC-003, AC-019                 | document spec                              | Document API/UI                            |
| FR-041 | UC-014                                 | AC-019, AC-041                 | document state                             | Document API/UI                            |
| FR-042 | UC-015, UC-017                         | AC-020, AC-039, AC-040         | event catalog / all states                 | Audit + Outbox                             |
| FR-043 | UC-015                                 | AC-020, AC-022                 | AuditEvent                                 | Audit API                                  |
| FR-044 | UC-015, UC-016                         | AC-020, AC-039, AC-040         | versioned artifacts                        | Persistence/Audit                          |
| FR-045 | —                                      | AC-013 historical only         | `SUPERSEDED_FOR_ACTIVE_MVP`                | no active implementation                   |
| FR-046 | —                                      | AC-013 historical only         | `SUPERSEDED_FOR_ACTIVE_MVP`                | no active implementation                   |
| FR-047 | —                                      | —                              | `RETIRED_FROM_ACTIVE_MVP`                  | no active implementation                   |
| FR-048 | UC-007                                 | AC-007, AC-022, AC-025         | evidence view                              | Scanner API/UI                             |
| FR-049 | UC-016                                 | AC-004, AC-020, AC-028, AC-039 | ScanJob/version state                      | API + Python Worker                        |
| FR-050 | UC-016                                 | AC-050A..AC-050F               | TrustedScanTrigger / ScanMappingResolution | API + Python Scan Trigger Worker           |
| FR-051 | —                                      | —                              | `REMOVED_FROM_PRODUCT`                     | no active or future product implementation |
| FR-052 | UC-010                                 | — Deferred                     | deferred clarification path                | no active implementation                   |
| FR-053 | UC-012                                 | AC-016                         | LegalSource/LegalDocument ingestion state  | Legal Ingestion Worker                     |
| FR-054 | UC-012                                 | AC-016, AC-035                 | LegalCorpusVersion state                   | Internal Approval Gate                     |
| FR-055 | UC-013                                 | AC-018, AC-037, AC-038         | LLM Gateway configuration                  | Platform / LLM Gateway                     |
| FR-056 | UC-012                                 | AC-016, AC-035, AC-036         | legal matching/index state                 | ChromaDB Legal Retriever                   |

## NFR Coverage

| NFR              | Primary FRs                                                    | Verification Focus                                                     |
| ---------------- | -------------------------------------------------------------- | ---------------------------------------------------------------------- |
| NFR-001..NFR-005 | FR-001..FR-005                                                 | auth/session/MFA/OAuth safety                                          |
| NFR-006, NFR-007 | FR-006, FR-016, FR-018                                         | identity/repository separation and read-only scope                     |
| NFR-008..NFR-010 | FR-007..FR-013, FR-028, FR-031, FR-042..FR-044, FR-047, FR-050 | RBAC, scoped collaboration, trigger/audit                              |
| NFR-011          | FR-042..FR-044, FR-050                                         | append-oriented audit                                                  |
| NFR-012..NFR-016 | FR-017..FR-023, FR-043, FR-044, FR-048, FR-055                 | source/privacy/evidence integrity                                      |
| NFR-017          | FR-032..FR-036, FR-053, FR-054, FR-056                         | legal citation/corpus provenance                                       |
| NFR-018..NFR-022 | FR-015, FR-021, FR-025..FR-041, FR-050                         | fail-closed, no overclaim, reliable/actionable states                  |
| NFR-023..NFR-026 | worker-driven FRs                                              | bounds, API-worker split, ownership, observability                     |
| NFR-027, NFR-028 | user-facing FRs                                                | accessibility and business-language UX                                 |
| NFR-029          | FR-023..FR-025, FR-032, FR-033, FR-056                         | claim evidence refs                                                    |
| NFR-030          | FR-017, FR-044, FR-049                                         | immutable rerun history                                                |
| NFR-033          | FR-055                                                         | LLM budget controls; embeddings future-only unless separately approved |
| NFR-034          | FR-032, FR-053, FR-054, FR-056                                 | immutable approved corpus                                              |
| NFR-035          | FR-018, FR-019                                                 | Python Worker sandbox/cleanup                                          |

## UX and Story Boundary

UX has been rebased against the pruned active authority set and reviewed for epic generation. Story coverage is assessable through `docs/planning-artifacts/epics.md`; certification-grade planning traceability is captured in `docs/test-artifacts/traceability/implementation-readiness-traceability-2026-06-25.md`.

```text
REQUIREMENT_TRACEABILITY_CORE_MATRIX_NORMALIZED
CANONICAL_UC_IDS_ONLY
FR_050_AUTOMATIC_TRUSTED_SCAN_INITIATION_TRACED
FR_051_REMOVED_FROM_PRODUCT
STRUCTURED_ATTESTATION_SUPERSEDED_FOR_ACTIVE_MVP
ACTIVE_REQUIREMENTS_TRACE_RECHECKED
ACCEPTANCE_CRITERIA_TRACE_RECHECKED
PROJECT_OWNER_DOC_REMEDIATION_APPROVED
SCANNER_BEHAVIOR_AUTHORITY_CONSOLIDATED
CHROMADB_VECTORLESS_DOMAIN_CONTRACT_ALIGNED
UX_REBASED_ACTIVE_DOC_SET
PYTHON_WORKER_PACKAGE_TOPOLOGY_LOCKED
AUDIT_EXPORT_SYNC_API_BOUNDARY_LOCKED
UX_REBASE_COMPLETE_AFTER_DOC_PRUNING
CHROMADB_STRUCTURE_FIRST_VECTORLESS_LEGAL_RAG_APPROVED
POSTGRESQL_PGVECTOR_LEGAL_RETRIEVAL_SUPERSEDED
STORY_TRACEABILITY_CREATED
STORY_COVERAGE_ASSESSABLE
CANONICAL_EPICS_AND_STORIES_ARTIFACT_PRESENT
```
