# LCSP User Task Flows

## Purpose

This document defines canonical user-facing and system task flows for the A-to-Z runnable MVP. It is domain-level workflow input for UX and stories, not implementation guidance.

## Flow Conventions

- Canonical IDs are `UC-001..UC-017`, `FR-001..FR-056`, and `AC-001..AC-041` plus Phase 5.2L `AC-050A..AC-050F`.
- Manager can complete the active MVP without Developer participation.
- Developer collaboration is optional and scoped.
- Structured attestation under historical `FR-045/FR-046` is `SUPERSEDED_FOR_ACTIVE_MVP` and has no active task flow.
- Delegated technical clarification under `FR-052` is Deferred and must not appear as an active screen or task.
- `FR-050` is `AUTOMATIC_TRUSTED_SCAN_INITIATION`; there is no manual scanner report upload UI/API.
- `FR-051` manual technical evidence JSON upload is `REMOVED_FROM_PRODUCT`.
- PBAC is the final server-side authorization source of truth.
- Legal corpus administration is an internal operations/API/CLI flow, not Manager/Developer product UX.
- UI states must use plain business language and expose actionable blocked/failed outcomes.

## Manager Product Flows

### 1. Authenticate and Enter Workspace

| Field | Content |
|---|---|
| Goal | Access the correct organization workspace safely. |
| Preconditions | User has an approved account/invitation. |
| Happy path | Register or sign in, complete MFA if required, select organization, enter dashboard. |
| Failure states | Invalid credentials, callback, OTP, expired session, missing membership, or rate limit. |
| UX requirements | Do not expose secrets or provider internals; show recovery action. |
| Traceability | UC-001, UC-002; FR-001..FR-012; AC-021..AC-026 |

### 2. Create Assessment

| Field | Content |
|---|---|
| Goal | Start a Manager-owned assessment. |
| Preconditions | Authenticated Manager belongs to organization. |
| Happy path | Open assessment list, create assessment, enter name/context, save. |
| Failure states | Missing tenant scope, duplicate/invalid input, unauthorized action. |
| Result | Assessment state `CREATED`; AuditEvent written. |
| Traceability | UC-003; FR-013; AC-001 |

### 3. Complete WizardProfile

| Field | Content |
|---|---|
| Goal | Capture business/legal context without requiring code knowledge. |
| Preconditions | Assessment exists and Manager owns it. |
| Happy path | Answer purpose, sector, data, affected people, user impact, decision role, oversight, and external LLM questions; save draft; submit. |
| Locked behavior | Wizard-only state shows readiness/gaps, never a risk level. |
| Failure states | Required field missing, stale draft, validation error. |
| Result | WizardProfile version saved; assessment becomes `WIZARD_PROFILE_READY`. |
| Traceability | UC-004; FR-014, FR-015, FR-040; AC-002, AC-003 |

### 4. Connect GitHub Repository

| Field | Content |
|---|---|
| Goal | Authorize a selected repository for evidence collection. |
| Preconditions | Assessment exists; actor has repository permission. |
| Happy path | Start GitHub App connection, select authorized repository and branch, confirm read-only scope. |
| Locked behavior | OAuth/OIDC login never grants repository access. |
| Failure states | App not installed, repository not selected, insufficient scope, revoked installation. |
| Result | RepositoryConnection exists; assessment becomes `REPOSITORY_CONNECTED`. |
| Traceability | UC-005; FR-006, FR-016; AC-004, AC-023 |

### 5. Select Commit and Create Snapshot

| Field | Content |
|---|---|
| Goal | Pin the evidence source before scanning. |
| Preconditions | RepositoryConnection exists. |
| Happy path | Select branch/commit, review commit metadata, create snapshot. |
| Failure states | Commit unavailable, repository scope changed, provider error. |
| Result | Immutable RepositorySnapshot exists; assessment becomes `SNAPSHOT_CREATED`. |
| Traceability | UC-006; FR-017; AC-004, AC-020 |

### 6. Run Repository Scan

| Field | Content |
|---|---|
| Goal | Request static analysis and monitor progress. |
| Preconditions | Trusted integration context exists or Manager action creates trusted context. |
| Happy path | Verified trigger creates or resumes a pending scan; Manager monitors queued/running/completed state. |
| System behavior | Python Scanner Worker owns lifecycle; toolchain includes Syft, Knip, deptry, `ast`/`libcst`, `ts-morph`, tree-sitter/custom parser, and Semgrep custom rules; no customer code execution; workspace is deleted before success event. |
| Failure states | Repository access failure, missing mapping, ambiguous assessment mapping, out-of-order trigger waiting, bounded parser/tool limitation, privacy/schema failure, TS/JS analyzer failure, workspace cleanup failure. |
| UX requirements | Show status, safe reason code, retry/rescan or mapping recovery action, and coverage limitations without raw source. |
| Result | TechnicalEvidenceReport exists or explicit failed state. |
| Traceability | UC-007, UC-016, UC-017; FR-018..FR-020, FR-049; AC-004, AC-005, AC-028..AC-032 |

### 7. Review Evidence and AIUsageFlow

| Field | Content |
|---|---|
| Goal | Understand what the system found and what remains uncertain. |
| Preconditions | Scan completed; TechnicalProfile/AIUsageFlow available or blocked. |
| Happy path | Review detected AI usage, inputs, outputs, downstream actions, human-review signals, confidence, evidence refs, and limitations. |
| Privacy | Show redacted metadata, file path/symbol/line refs, and hashes only; no raw source, secret, full prompt, or full AST. |
| Failure states | Evidence insufficient, profile blocked, claims unclear, worker failed. |
| Result | No state change by review alone. |
| Traceability | UC-008, UC-009; FR-021..FR-025, FR-048; AC-006..AC-009, AC-031, AC-032 |

### 8. Resolve Reconciliation Conflict

| Field | Content |
|---|---|
| Goal | Resolve mismatch between WizardProfile and evidence-derived facts. |
| Preconditions | ReconciliationConflict exists. |
| Happy path | Open conflict, compare declared and detected values, inspect evidence refs, select resolution, enter rationale, submit. |
| Optional input | None from structured attestation. Developer collaboration may remain only for independently valuable scoped technical assistance. |
| Locked behavior | Manager is final resolver; scanner evidence is immutable; structured attestation is not an active MVP input. |
| Deferred exclusion | No free-form delegated clarification task or screen under `FR-052`. |
| Failure states | Missing rationale, stale conflict, unauthorized actor, unresolved blocking field. |
| Result | Reconciliation reruns; conflict remains open or VerifiedProfile becomes ready. |
| Traceability | UC-010, UC-011; FR-026..FR-031; AC-010..AC-015, AC-033 |

### 9. Review VerifiedProfile Readiness

| Field | Content |
|---|---|
| Goal | Confirm that the reconciled basis is ready for legal matching. |
| Preconditions | No unresolved material conflict. |
| Happy path | Review merged facts, evidence provenance, Manager resolutions, and version; approve where workflow requires. |
| Failure states | Conflict reopened, evidence stale, missing required claim. |
| Result | `VERIFIED_PROFILE_READY`. |
| Traceability | UC-011; FR-030, FR-031; AC-014, AC-015 |

### 10. Run and Review Classification

| Field | Content |
|---|---|
| Goal | Obtain a citation-backed classification or an explicit blocked state. |
| Preconditions | Accepted technical evidence exists; approved legal corpus and EngineeringRules are available or fail closed with diagnostics; real provider configured for acceptance run. |
| Happy path | Request classification or observe automatic trigger, monitor status, review risk level/confidence/EngineeringRule evaluations/citations. |
| Failure states | Missing citation, unapproved corpus, zero candidate match, provider outage, invalid model output, unknown critical usage. |
| UX requirements | Never display unsupported legal certainty; show blocked/degraded reason and next action. |
| Result | `CLASSIFICATION_READY` or `CLASSIFICATION_BLOCKED`. |
| Traceability | UC-012, UC-013; FR-032..FR-037, FR-053..FR-056; AC-016..AC-018, AC-034..AC-038 |

### 11. Review Gap Analysis

| Field | Content |
|---|---|
| Goal | Understand compliance gaps and required actions. |
| Preconditions | Classification completed or explicitly eligible for degraded gap analysis. |
| Happy path | Review gap items, priority, obligation/citation refs, and evidence basis. |
| Failure states | Classification blocked, citation incomplete, worker failure. |
| Result | `GAP_ANALYSIS_READY` or `GAP_ANALYSIS_BLOCKED`. |
| Traceability | UC-014; FR-038; AC-018, AC-019 |

### 12. Generate, Download, and Review Document

| Field | Content |
|---|---|
| Goal | Produce final compliance-support report or readiness-only export. |
| Preconditions | Final report requires valid classification, gap analysis, legal citations, and no conflict. |
| Happy path | Request generation, monitor status, preview metadata, download artifact. |
| Alternative | Readiness-only export may be generated earlier and must contain no risk level. |
| Failure states | Guardrail violation, missing citation, object-storage error, provider failure, generation blocked. |
| Result | `DOCUMENT_GENERATED` or `DOCUMENT_BLOCKED`. |
| Traceability | UC-014; FR-038..FR-041; AC-003, AC-018, AC-019, AC-041 |

### 13. Review and Export Audit Trail

| Field | Content |
|---|---|
| Goal | Trace decisions, versions, events, and blocked states. |
| Preconditions | Assessment exists. |
| Happy path | Filter events, inspect actor/action/object/version/correlation/evidence refs, export allowed metadata. |
| Privacy | No raw source, secrets, raw provider tokens, or full prompts. |
| Failure states | Export denied, unavailable event page, redaction failure. |
| Result | Auditable assessment record and export. |
| Traceability | UC-015; FR-042..FR-044; AC-020, AC-039, AC-040 |

## Optional Developer Product Flows

### 14. Accept Scoped Task

| Field | Content |
|---|---|
| Goal | Enter a limited collaboration scope. |
| Preconditions | Manager invited Developer and assigned active policy/task. |
| Happy path | Open invitation/task, review scope, accept. |
| Failure states | Expired/revoked invitation, wrong organization, policy removed. |
| Result | Task becomes active; Manager flow remains independent. |
| Traceability | UC-002; FR-010, FR-011, FR-047; AC-025, AC-026 |

### 15. Review Redacted Technical Findings

| Field | Content |
|---|---|
| Goal | Review assigned technical evidence without unnecessary business/source exposure. |
| Preconditions | Developer has active scoped permission. |
| Happy path | View only assigned findings, evidence refs, confidence, and limitations. |
| Failure states | Permission revoked, task expired, assessment outside scope. |
| Result | No assessment lifecycle state change. |
| Traceability | UC-007; FR-048; AC-007, AC-022, AC-025 |

### 16. Removed Structured Technical Attestation

| Field | Content |
|---|---|
| Status | `SUPERSEDED_FOR_ACTIVE_MVP`. |
| Required behavior | No Manager or Developer active screen, route, form, DTO, command, event, entity, audit dependency, report dependency, acceptance criterion, epic, story, or delivery task may preserve structured attestation as an MVP feature. |
| Historical rule | Prior records may remain in git history only. Reintroduction requires separate Project Owner approval. |
| Traceability | Historical `FR-045/FR-046`, `UC-018`, and `AC-013` only. |

## System Flows

### Repository Scan Orchestration

```text
command.scan.requested.v1
-> Python Worker RUNNING
-> snapshot materialization
-> Syft SBOM/dependency inventory
-> Knip/deptry dependency usage analysis
-> Python AST/CST analysis
-> TS/JS subprocess analysis
-> tree-sitter/custom parser structural augmentation
-> Semgrep custom AI rules
-> evidence/report gates
-> workspace cleanup verification
-> event.scan.completed.v1 or event.scan.failed.v1
```

### Automatic Trusted Scan Initiation

```text
trusted trigger received
-> context validation
-> PENDING_MAPPING | BLOCKED_MAPPING | WAITING_FOR_CONTEXT | READY_TO_SNAPSHOT
-> snapshot pending
-> scan pending/running
-> completed or failed
```

Triggers include verified GitHub webhooks, scheduled integration triggers, backend-issued triggers, and authorized Manager actions that create trusted context. Duplicate and out-of-order events must not scan the wrong repository or assessment.

### Evidence-to-Profile Orchestration

```text
TechnicalEvidenceReport QUALITY_VALID
-> TechnicalProfile
-> AIUsageFlow
-> ReconciliationConflict or VerifiedProfile
```

### Legal-to-Document Orchestration

```text
VerifiedProfile
-> Hybrid Retrieval / LegalRuleMatch
-> RiskClassification
-> GapAnalysis
-> GeneratedDocument
```

Every async state shows loading, timeout, failed, blocked, retry/re-run, and audit-reference behavior in UX.

## Internal Legal Operations Flow

The following is required system functionality but excluded from Manager/Developer UX scope:

```text
approved source URL
-> ingest snapshot
-> hash and normalize
-> internal legal review
-> approve immutable LegalCorpusVersion
-> build ChromaDB vectorless legal index
-> expose approved version to retrieval
```

The MVP interface for this actor is internal API/CLI and operational audit records. A customer-facing corpus administration console is Post-MVP.

## UX Deliverable Boundary

`bmad-ux` must produce canonical Manager and optional Developer experiences for active flows, including responsive layouts, accessibility, empty/loading/error/blocked/degraded states, automatic trigger mapping states, status language, evidence/citation disclosure, and safe recovery actions. It must not create active screens for manual scanner report upload, `FR-051`, `FR-052`, structured attestation, or customer-facing corpus administration.
