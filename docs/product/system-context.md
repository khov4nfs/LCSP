# LCSP System Context

## Purpose

This document defines what LCSP is, who uses it, and how an assessment moves from Manager intent to evidence-backed classification, reporting, and audit. It is a domain-level source of truth, not backlog, story, implementation, or validation material.

## Problem Statement

Vietnamese businesses using AI need a traceable way to understand and document compliance posture without relying only on self-declared checklists or free-form legal chatbot answers. LCSP combines Manager-provided business context, repository-derived technical evidence, conflict reconciliation, direct EngineeringRule classification with citation-backed legal provenance, gap analysis, document generation, and audit trail.

## Product Vision

LCSP is an evidence-based compliance support platform for businesses using AI in Vietnam. It supports compliance work and must not preserve product concepts for compliance certification, formal legal opinion, direct regulator submission, or unsupported legal conclusions.

## Phase 5.2L Product Corrections

- RBAC replaces RBAC as authorization source of truth. Roles are attributes/templates only.
- Structured attestation is `SUPERSEDED_FOR_ACTIVE_MVP` and removed from active product scope.
- Compliance certification, formal legal opinion, direct regulator submission, and manual technical evidence JSON upload (`FR-051`) are `REMOVED_FROM_PRODUCT`.
- `FR-050` is `AUTOMATIC_TRUSTED_SCAN_INITIATION`, not Local/CI scanner report upload.
- All asynchronous domain workloads use the Python Worker Platform. Node.js is valid only for NestJS API, web/tooling, and the bounded TS/JS analyzer CLI.

## Product Scope

```text
Manager intent
-> WizardProfile
-> Automatic Trusted Scan Initiation / Repository Scan
-> TechnicalEvidenceReport
-> TechnicalProfile
-> AIUsageFlow
-> Conflict reconciliation when required
-> Direct EngineeringRule Assessment
-> RiskClassification
-> GapAnalysis
-> GeneratedDocument
-> AuditEvent
```

## In Scope

- Manager-led assessment lifecycle.
- OAuth/OIDC login separated from GitHub App repository authorization.
- Self-signup and Manager-owned workspace entry.
- Read-only GitHub repository connection and commit-pinned Repository Scan.
- Python Worker Platform-owned asynchronous domain work.
- Python Scanner Worker static analysis with Syft, Knip, deptry, Python `ast`/`libcst`, bounded `ts-morph`, tree-sitter/custom parser, and Semgrep custom rules.
- Evidence gates, TechnicalProfile, AIUsageFlow context, and Manager-only conflict resolution.
- Provenance-preserving legal corpus ingestion from approved official-source URLs.
- Internal corpus review/approval and immutable LegalCorpusVersion management.
- Direct EngineeringRule assessment with stable LegalRule provenance, citation refs, evidence refs and fail-closed diagnostics.
- Real configured LLM provider for A-to-Z acceptance; deterministic mock only for tests/offline development.
- Risk classification only after evidence gates, approved legal-rule basis, citation traceability and conflict checks.
- Gap analysis, final report, readiness-only export, artifact download, and audit export.

## Out of Scope

- Enterprise SSO/SAML/SCIM and advanced identity administration.
- Structured attestation must not appear as active MVP input.
- Local/CI scanner report upload as active or future product path; it is superseded by `FR-050` automatic trusted scan initiation.
- Manual technical evidence JSON upload (`FR-051`) must not appear in active scope, roadmap, future scope, APIs, entities, UX, or delivery plans; it is `REMOVED_FROM_PRODUCT`.
- Delegated free-form technical clarification workflow (`FR-052` is Deferred).
- Customer-facing legal corpus administration.
- Runtime scanner accuracy claims before post-implementation empirical acceptance.
- Risk level based only on Wizard answers, provider package, model name, or framework detection.
- Final report when critical conflict, insufficient evidence, missing approved corpus, or missing citation remains unresolved.

## Primary Product Actors

| Actor       | Responsibility                                                                                                                     | Key Tasks                                                                                                                                                               |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Manager     | Owns assessment, business/legal truth, final MVP conflict resolution, classification request, report generation, and audit review. | Create assessment, complete Wizard, connect repository, start scan, review evidence, resolve conflicts, request classification, generate/download report, export audit. |
| LCSP System | Enforces workflow gates, state transitions, evidence handling, queue choreography, retrieval, audit, and output guardrails.        | Execute workers, persist domain objects, publish commands/events, block unsafe output.                                                                                  |

Manager can complete the active MVP golden path without external collaborator participation.

## Internal Operations Actor

| Actor                   | Responsibility                                                                                                                      | UX Boundary                                                                                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Internal Legal Operator | Validates official-source URLs, reviews normalized legal documents, approves or rejects corpus versions, and audits corpus changes. | Internal operations/API/CLI only for MVP. No Manager product screen is required by `bmad-ux`. |

This boundary is locked for the MVP. A future dedicated Legal Operator web console would require a separate scope decision and stories.

## External Systems

| System                                       | Used For                                                  | Boundary                                                                                                                           |
| -------------------------------------------- | --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| OAuth/OIDC Provider                          | User login and identity verification.                     | Does not grant repository access.                                                                                                  |
| GitHub App                                   | Read-only selected repository access and commit snapshot. | Separate from user login.                                                                                                          |
| Official Legal Sources                       | Legal document ingestion and provenance.                  | Source candidates require validation before ingestion is accepted.                                                                 |
| Legal Corpus / ChromaDB Vectorless Retriever | Versioned legal retrieval and citation traceability.      | Approved immutable corpus only; retrieval uses legal structure, metadata/full-text lookup, xref expansion and citation allowlists. |
| LLM Provider                                 | Structured assisted classification/generation.            | No raw source, secrets, full prompts, or full AST bodies.                                                                          |
| Object Storage                               | Legal source snapshots and generated document artifacts.  | Real S3-compatible storage for A-to-Z acceptance.                                                                                  |

## High-Level Manager Journey

```text
Login
-> Create Assessment
-> Complete WizardProfile
-> Connect Repository
-> Select Commit
-> Automatic trusted scan starts or resumes Repository Scan
-> Review Findings and AIUsageFlow
-> Resolve Conflict if present
-> Run EngineeringRule Classification
-> Review Gap Analysis
-> Generate and Download Report
-> Review and Export Audit Trail
```

## Retired Developer Journey

```text
Developer invitation
-> invitation acceptance
-> scoped task workspace
-> membership revocation UI/API
```

This path is retired from the active MVP. Historical `AUTH_INVITATION` audit resource values may remain for old audit records only.

## Internal Legal Operations Journey

```text
Validate source URL
-> Ingest PDF/HTML snapshot
-> Compute hash and extract metadata
-> Normalize legal hierarchy
-> Review document and relationships
-> Approve LegalCorpusVersion
-> Build ChromaDB structure-first vectorless legal index
-> Make approved version available to retrieval
```

This journey is not part of the Manager product UX deliverable.

## Assessment Lifecycle

```text
CREATED
-> WIZARD_PROFILE_READY
-> REPOSITORY_CONNECTED
-> TRUSTED_SCAN_TRIGGERED
-> SNAPSHOT_CREATED or PENDING_MAPPING/BLOCKED_MAPPING/WAITING_FOR_CONTEXT
-> SCAN_REQUESTED
-> SCAN_RUNNING
-> SCAN_COMPLETED
-> TECHNICAL_PROFILE_READY
-> AI_USAGE_FLOW_READY
-> RECONCILIATION_REQUIRED or VERIFIED_PROFILE_READY
-> LEGAL_MATCHING_READY
-> CLASSIFICATION_READY or CLASSIFICATION_BLOCKED
-> GAP_ANALYSIS_READY or GAP_ANALYSIS_BLOCKED
-> DOCUMENT_GENERATED or DOCUMENT_BLOCKED
```

## Classification Gates

Classification is blocked or explicitly degraded when:

- VerifiedProfile does not exist;
- any material conflict remains unresolved;
- critical AI usage is unknown or unsupported;
- approved legal corpus is unavailable;
- required legal citation coverage is missing;
- provider/model/framework presence is the only evidence;
- configured real LLM provider is unavailable for the acceptance run.

## Reporting Gates

A final report requires classification, gap analysis, evidence trace, legal citation trace, approved corpus version, and no unresolved conflict. Readiness-only output may exist earlier but must not contain a risk level or compliance-certification wording.

## Key Outcomes

- Manager understands what is needed before classification.
- Technical evidence is traceable to repository snapshot metadata and evidence refs.
- Business declarations and technical findings are reconciled before legal matching.
- Legal conclusions are citation-backed or blocked/degraded.
- Generated documents trace to evidence, legal basis, corpus version, and Manager decisions.
- Material workflow and security actions are auditable.

## UX Handoff Boundary

`bmad-ux` must design Manager product flows only. It must represent blocked, failed, loading, retry, empty, and permission-denied states. Developer invitations/tasks and Internal Legal Operator corpus administration remain outside the customer-facing UX scope for MVP.
