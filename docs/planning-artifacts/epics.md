---
stepsCompleted:
  - step-01-validate-prerequisites
  - step-02-design-epics
  - step-03-generate-stories
  - step-04-final-validation
inputDocuments:
  - docs/product/prd.md
  - docs/architecture/architecture.md
  - docs/architecture/multi-agent-system-architecture.md
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/DESIGN.md
  - docs/planning-artifacts/ux-designs/ux-LCSP-2026-06-24/EXPERIENCE.md
  - docs/planning-artifacts/canonical-ux-review-2026-06-25.md
  - docs/specs/functional-requirements.md
  - docs/specs/non-functional-requirements.md
  - docs/specs/scanner-spec.md
  - docs/specs/legal-matching-domain-spec.md
  - docs/specs/user-task-flows.md
  - docs/specs/requirements-traceability-summary.md
excludedInputDocuments:
  - docs/archive/**
  - git history for deprecated prototype UX/epic/story artifacts
---

# LCSP — Legal Compliance Support Platform - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for LCSP, decomposing the requirements from the PRD, rebased UX draft, canonical UX review, architecture, scanner specification, legal matching specification, user task flows, functional requirements, and non-functional requirements into implementable stories.

Steps 01-03 are complete: requirements were extracted, epics were designed, and approved story sets were generated with party-review remediation applied.

## Requirements Inventory

### Functional Requirements

FR-001: Register account through approved path.

FR-002: Authenticate before workspace access.

FR-003: Configure and enforce MFA.

FR-004: Manage session, recovery, and profile.

FR-005: Support safe OAuth/OIDC login.

FR-006: Separate OAuth identity from GitHub authorization.

FR-007: Create organization.

FR-008: Manage organization members.

FR-009: Assign Manager subject attributes and policy templates.

FR-010: Invite optional Developer collaborator.

FR-011: Assign and revoke Developer RBAC policy scope.

FR-012: Enforce RBAC-protected Manager-only actions.

FR-013: Create Manager-owned assessment.

FR-014: Complete WizardProfile.

FR-015: Show readiness without risk level.

FR-016: Connect selected read-only GitHub repository.

FR-017: Create commit-pinned snapshot.

FR-018: Run static scan through Python Worker.

FR-019: Enforce scanner privacy and cleanup.

FR-020: Validate evidence schema and privacy flags.

FR-021: Evaluate evidence quality and actionability.

FR-022: Generate TechnicalProfile.

FR-023: Detect evidence-backed AI usage signals.

FR-024: Generate claim-level AIUsageFlow.

FR-025: Preserve unknown or unclear usage.

FR-026: Detect evidence reconciliation conflict.

FR-027: Calculate explanatory Conflict Score.

FR-028: Route conflicts to Manager.

FR-029: Resolve conflicts by Manager.

FR-030: Create VerifiedProfile after gates.

FR-031: Review and approve VerifiedProfile where required.

FR-032: Retrieve legal rules and citations from approved corpus.

FR-033: Match legal rules by verified usage.

FR-034: Block or degrade output without citations.

FR-035: Run classification after legal matching.

FR-036: Produce cited result or blocked state.

FR-037: View classification status or result.

FR-038: Generate GapAnalysis.

FR-039: Generate guarded final report.

FR-040: Generate readiness-only export.

FR-041: View and download document status or artifact.

FR-042: Write material audit events.

FR-043: View and export redacted audit trail.

FR-044: Track immutable artifact versions.

FR-045: Historical structured-attestation disclosure requirement; `SUPERSEDED_FOR_ACTIVE_MVP`; do not create active UX, API, entity, event, story, delivery, audit, classification, or report dependency.

FR-046: Historical structured supplemental attestation; `SUPERSEDED_FOR_ACTIVE_MVP`; do not create active UX, API, entity, event, story, delivery, audit, classification, or report dependency.

FR-047: Accept scoped Developer task with independent product value.

FR-048: View redacted technical findings.

FR-049: Re-run scan without mutating history.

FR-050: Automatic trusted scan initiation.

FR-051: Manual technical evidence JSON upload; `REMOVED_FROM_PRODUCT`; do not create active or future-scope product stories.

FR-052: Delegated free-form clarification; `DEFERRED_POST_MVP`; do not create active MVP screen or task unless separately approved.

FR-053: Ingest validated legal source snapshots.

FR-054: Approve immutable LegalCorpusVersion.

FR-055: Configure real LLM provider and budget controls.

FR-056: Run ChromaDB structure-first vectorless legal retrieval with xref expansion and citation allowlist validation.

### NonFunctional Requirements

NFR-001: Password, OAuth/OIDC and session authentication controls must prevent unauthorized workspace access.

NFR-002: Sessions must expire, be revocable and respect MFA/auth policy.

NFR-003: MFA secrets and OTP verification must avoid plaintext secret storage and reject invalid, expired or replayed codes.

NFR-004: Login, MFA and reset flows must rate-limit repeated failures.

NFR-005: OAuth/OIDC callback handling must validate redirect URI, state, nonce, issuer, audience, expiry and safe account linking.

NFR-006: OAuth/OIDC login must remain separate from GitHub App repository authorization.

NFR-007: GitHub App access must be read-only and limited to selected repositories for MVP.

NFR-008: RBAC must enforce organization-scoped authorization for customer APIs, internal APIs, worker identities, repository access, scan triggers, assessment transitions, legal operations, document downloads, audit exports and administrative operations.

NFR-009: Developer access must be scoped to assigned RBAC policy scope and revocable.

NFR-010: Material workflow, auth, RBAC decisions, delegation, evidence, scan trigger, conflict, classification and document events must be audited.

NFR-011: Audit trail must be append-oriented with controlled correction model.

NFR-012: Raw source code must never be sent to an LLM provider.

NFR-013: Raw source code must not be stored long term in persistent stores.

NFR-014: Technical findings must avoid unnecessary source/code exposure.

NFR-015: Secrets must be redacted before logs, findings, reports, prompts or audit records.

NFR-016: Accepted evidence reports and scanner tool outputs must include provenance, version, config/ruleset hash and integrity metadata.

NFR-017: Legal classification outputs must trace to legal rule, citation and corpus version.

NFR-018: System must fail closed for missing critical evidence, unresolved conflict, unknown critical usage or missing legal citation.

NFR-019: Classification must use evidence-backed VerifiedProfile and LegalRuleMatch, not provider/model/framework presence alone.

NFR-020: Generated reports must not overclaim evidence, legal certainty, validation, certification or production readiness.

NFR-021: Long-running scan, legal matching, classification and document work must not depend on web request lifecycle.

NFR-022: User-facing workflow must expose blocked/failed states with actionable next step.

NFR-023: MVP scan and worker operations must be bounded by file-size, timeout, CPU, memory, output and retry policies.

NFR-024: API runtime and Python Worker Platform workloads must remain separable.

NFR-025: Domain modules must have clear ownership of DTOs, tables, queues and state transitions.

NFR-026: Evidence gate, queue, worker, classification and document failures must be visible with correlation ID.

NFR-027: Web forms, status messages and document review screens should meet common accessibility expectations.

NFR-028: Manager-facing Wizard and locked states must use business language and avoid unexplained implementation terms.

NFR-029: AIUsageFlow claims must carry evidence refs and uncertainty reasons for material fields.

NFR-030: Re-runs must preserve historical evidence/profile/classification chain rather than mutating prior records.

NFR-033: LLM API calls must be protected by monthly cost budget boundaries and token usage caps; dense embedding calls are not required for legal retrieval MVP.

NFR-034: Pinned legal corpus snapshots must remain immutable, with updates governed by formal review and approval.

NFR-035: Python Scanner Worker must operate in a restricted scanner workspace with pinned scanner tools, bounded resources, no dependency installation, no customer application execution, validated/redacted tool output and verified cleanup.

### Additional Requirements

- Architecture style is `Web Frontend -> NestJS API synchronous control plane -> Python Worker Platform -> Persistence / Legal Retrieval / Object Storage`.
- Web Frontend owns Manager workspace for assessment, repository connection, scan progress, conflict resolution, classification and documents.
- Backend API owns auth, RBAC enforcement boundary, assessment state, synchronous user actions, trusted trigger creation and async work creation.
- Repository Integration must keep read-only repository authorization separate from OAuth/OIDC login.
- Python Worker Platform owns all async domain workloads through bounded consumers/modules.
- Python Scanner Worker owns repository scan lifecycle and must use Syft, Knip, deptry, Python `ast`/`libcst`, bounded `ts-morph`, tree-sitter/custom parser and Semgrep custom rules.
- Legal Source Ingestion Worker fetches official legal sources, snapshots raw PDF/HTML into S3-compatible object storage, normalizes legal structure and stages corpus versions for review.
- Internal Legal Operator approval creates approved immutable `LegalCorpusVersion`; this is internal operations/API/CLI scope, not customer-facing Manager/Developer UX.
- ChromaDB Legal Indexer builds a structure-first vectorless index using document/chunk storage, stable hierarchical IDs, metadata filters, full-text records, direct ID lookup and cross-reference metadata.
- ChromaDB Legal Retriever retrieves citation-backed legal rules using full-text/metadata candidates, direct chunk/article lookup, parent-context assembly, one-hop xref expansion and citation allowlist validation.
- Legal retrieval base unit is Clause (`Khoản`); Point (`Điểm`) content is assembled with parent Clause and Article context.
- Citations may point only to retrieved primary chunks, parent context chunks or referenced context chunks; out-of-allowlist citations are rejected.
- `PRIMARY_MATCH`, `PARENT_CONTEXT` and `REFERENCED_CONTEXT` must remain distinct in data, audit and UX.
- Classification requires VerifiedProfile plus persisted LegalRuleMatch; it must not consume `verified-profile-ready` directly.
- Citation Guardrail blocks or degrades legal matching, classification and documents when citation/rule basis is missing or corpus version is not approved.
- LLM Gateway is the only model boundary; raw source, full prompts, secrets, provider tokens and full AST bodies are forbidden in LLM payloads.
- Real LLM provider/model configuration, credentials, token/cost controls and privacy boundaries are required for A-to-Z acceptance; mock mode is unit/offline-only.
- Each major stage persists typed output before the next stage runs; hidden synchronous jumps across workflow gates are forbidden.
- RBAC is the authorization source of truth. Roles are only subject attributes/templates.
- Manager can complete active MVP flow without Developer assignment.
- GitHub App read-only Repository Scan is the golden technical-evidence path.
- `FR-050` replaces Local/CI scanner report upload with Automatic Trusted Scan Initiation.
- `FR-051` manual technical evidence JSON upload is removed from product scope.
- `FR-052` delegated free-form clarification is Deferred/Post-MVP.
- Structured attestation is superseded and must not re-enter active MVP stories.
- Scanner is static-analysis only; it must not execute source, install dependencies, run builds/tests/scripts/Docker/CI, probe endpoints, persist raw source or send raw source to LLM.
- Scanner tool failure severity table and tool version/config/ruleset hash policy are governed by `docs/implementation/decisions/scanner-severity-tool-provenance-decision.md`.
- RBAC engine, policy storage, cache, invalidation, evaluation topology and failure behavior are governed by `docs/implementation/decisions/rbac-runtime-decision.md`.
- Automatic trusted scan trigger idempotency, retry/DLQ, replay authority and operator recovery are governed by `docs/implementation/decisions/trusted-scan-trigger-retry-dlq-replay-decision.md`.

### UX Design Requirements

UX-DR1: Implement an operational compliance workbench visual style using restrained neutral surfaces, primary teal actions, amber blocked/degraded states, green completed states, red destructive/security states and blue provenance/audit states.

UX-DR2: Use stable typography hierarchy with display titles only at workspace level; compact panels, cards, tables and sidebars must use smaller headings and readable metadata captions.

UX-DR3: Provide responsive layout with persistent desktop sidebar, top workspace bar, constrained main content, tablet-collapsed navigation and mobile stacked task screens.

UX-DR4: Use work-object cards only for assessment, wizard section, evidence report, conflict, legal match, gap item and document artifact; do not nest cards or use decorative card sections.

UX-DR5: Build reusable components for primary button, evidence card, blocked banner, citation chip, workflow stepper, status badge and data table.

UX-DR6: Workflow stepper must distinguish completed, current, blocked, deferred and not-yet-eligible states and must never skip hidden gates.

UX-DR7: Assessment overview must show workflow stage, blockers, readiness, next action and audit refs.

UX-DR8: WizardProfile UX must capture business/legal context in non-technical language with examples, progressive disclosure and no risk terminology while incomplete or Wizard-only.

UX-DR9: Readiness panel must show preparation guidance and missing evidence before technical evidence; it must never show HIGH/MEDIUM/LOW risk.

UX-DR10: Repository connection UX must clearly separate OAuth/OIDC sign-in from GitHub App repository authorization.

UX-DR11: Snapshot and scan UX must show branch, commit SHA, immutable snapshot ID, queued/running/completed/failed states, safe reason codes, coverage limitations and retry/re-run behavior without raw source.

UX-DR12: Evidence review UX must show redacted findings, AIUsageFlow, confidence, limitations, evidence refs and blocked downstream stage when evidence is insufficient.

UX-DR13: Conflict comparison UX must show Manager declaration, evidence-derived fact, evidence refs, confidence, uncertainty reason, required rationale and stale/missing-rationale validation.

UX-DR14: VerifiedProfile review UX must show merged facts, provenance, version and zero unresolved-warning count before classification.

UX-DR15: Classification UX must display risk only after evidence basis, legal matches, citation detail, model metadata summary and audit refs exist.

UX-DR16: Legal corpus/index failures must appear only as assessment-relevant blocked legal-retrieval states; customer-facing corpus administration is excluded.

UX-DR17: Citation detail drawer must show document title/number, article, clause, point, context role, corpus version, effective dates, legal status, source URL/checksum and allowlist result.

UX-DR18: Referenced context must never be visually promoted as primary legal basis; it must appear below primary match with xref reason.

UX-DR19: Citation outside retrieved/referenced allowlist must reject classification/document output and display a guardrail failure without risk level.

UX-DR20: Gap analysis UX must show obligation gaps, evidence gaps, priorities and citation refs and must explain upstream dependency when blocked.

UX-DR21: Documents UX must distinguish readiness-only export from final report in title, badge, preview, metadata and download state.

UX-DR22: Final report UX must show document version, inputs, classification/gap refs, corpus version and download only after guardrails pass.

UX-DR23: Audit trail table must filter by stage, actor/service, action, outcome, correlation ID, policy ID/version and evidence/citation ref; it must exclude raw source, full prompts, secrets and raw provider tokens.

UX-DR24: Developer task workspace must show granted RBAC scope, expiry/revocation state, hidden data boundaries and assigned redacted technical findings only.

UX-DR25: Permission denied states must hide inaccessible data where possible and show denied action and recovery path without internal policy details.

UX-DR26: All blocked, failed, loading, completed and generated states must be announced to assistive technology and must not rely on color alone.

UX-DR27: Citation drawers and conflict dialogs must trap focus while open and return focus to the invoking control on close.

UX-DR28: Long IDs and legal references must be copyable without requiring precise mouse selection.

UX-DR29: Reduce Motion must disable non-essential transitions and progress animations.

UX-DR30: Active UX, epics and stories must not include structured technical attestation, manual evidence JSON upload, Local/CI scanner report upload as an MVP path, delegated free-form clarification screens or customer-facing corpus administration.

UX-DR31: Open UX dependencies to carry into stories are Vietnamese microcopy for Wizard/blocker explanations, readiness-only export contents, automatic trusted trigger mapping wording and frontend component library choice.

## Cross-Epic Guardrails

- Every user-visible read, write, action, download or export of workspace-scoped business data must enforce RBAC using workspace scope, actor or system identity, subject attributes, action and resource context.
- Every state-changing operation and trusted trigger execution must emit an audit event with actor or system identity, workspace or organization scope, entity type, entity ID, action, result, correlation ID and timestamp.
- Risk, severity, violation, non-compliant or equivalent authoritative labels must not be persisted or shown before their explicit validation gates pass. Pre-gate outputs may use neutral statuses such as `finding`, `candidate issue`, `requires review`, `uncertain`, `blocked`, `readiness-only` or `unverified gap`.
- `FR-045`, `FR-046`, `FR-051` and `FR-052` are negative acceptance criteria and negative test cases, not standalone feature stories or active user journeys.
- Structured attestation, manual technical evidence JSON upload, Local/CI scanner report upload as an MVP evidence path, delegated free-form clarification screens and customer-facing corpus administration must not reappear in active stories.
- Guardrail ownership is local to each epic when the story touches that boundary; shared RBAC, audit, trigger, citation and gate primitives may be implemented as reusable platform stories where needed.

## Handoff Invariant

Stories must preserve this evidence and decision lineage:

```text
RBAC-scoped Workspace
-> StructuredAssessment / StructuredEvidence
-> TechnicalProfile
-> AIUsageFlow
-> VerifiedProfile
-> LegalRuleMatch
-> Classification
-> GapAnalysis / Documents / Audit
```

Each epic handoff must define producer, consumer, artifact or schema, required identifiers, RBAC scope, audit event, validation gate and failure behavior. A story may consume an upstream artifact only after the producing story defines ownership, validation state and auditability. Audit is a cross-cutting side effect at each material transition, not only a final-report feature.

## Story-Generation Constraints

- Each story should produce one primary testable artifact: API contract, persisted entity, event, worker behavior, UI state, report output or explicit spike decision.
- TechnicalProfile, AIUsageFlow, VerifiedProfile and LegalRuleMatch must remain separately testable boundaries with distinct input artifact, output artifact, authority boundary and audit behavior.
- Stories touching trusted trigger behavior must include idempotency key behavior, retry policy, DLQ or failure state, audit emission and replay-safe tests.
- Scanner severity classification must be spike-gated or validation-gated before any severity value is persisted or shown as authoritative.
- Stories touching citation behavior must include citation allowlist enforcement, retrieval `context_role` checks, missing/invalid citation handling and tests proving unapproved sources are rejected.
- Stories touching RBAC-protected surfaces must include authorization negative tests for read, write, action and export paths.
- Stories touching generated outputs must prove provenance from assessment, evidence, AIUsageFlow claim, LegalRuleMatch, classification, gap and document version where applicable.

## Canonical Status and Testability Model

Stories must use these user-visible state classes consistently:

| State Class | User-visible label | Downstream eligibility | Report/download implication | Terminal |
| --- | --- | --- | --- | --- |
| `READINESS_ONLY` | Readiness-only | No final classification | Only readiness artifacts allowed | No |
| `BLOCKED_NO_CLASSIFICATION` | Blocked - no classification | No legal matching/classification or final report until blocker clears | Final report blocked | No |
| `DEGRADED_NOT_FINAL` | Degraded - not final | May show diagnostic evidence, no final risk label | Final report blocked; readiness/evidence report allowed | No |
| `FINAL_CLASSIFICATION` | Final classification | Gap analysis and final report allowed if output gates pass | Final report allowed | Yes for that version |
| `SUPERSEDED_VERSION` | Superseded version | Historical only | Historical download only if RBAC permits | Yes |

Policy-dependent wording in stories must resolve to enumerated reason codes or referenced decision artifacts before implementation readiness. Required decision artifacts are:

- RBAC policy/runtime contract and deny-on-failure reason codes.
- Scanner severity table covering per-tool timeout, crash, partial output, unsupported language, redaction failure, cleanup failure, missing config hash, missing ruleset hash and downstream eligibility.
- Worker replay contract covering idempotency key format, duplicate behavior, retry budget, DLQ reason codes, replay authority and immutable-result rules per worker domain.
- Citation validation reason codes for fabricated locator, wrong corpus version, stale effective date, parent-as-primary misuse, referenced-as-primary misuse and out-of-allowlist citation.
- State-transition table with allowed transition, audit event name, UI label class and downstream eligibility for assessment, scan, evidence, legal matching, classification and document artifacts.

## Story-Level Traceability Requirement

Before implementation readiness can pass, this artifact or a companion traceability artifact must provide story-level trace rows:

```text
FR/NFR/UX/control -> story ID -> acceptance criterion ID -> test level -> owner -> evidence artifact
```

Minimum required coverage rows: RBAC deny-by-default, Developer optionality, trusted scan trigger idempotency, scanner severity, evidence privacy gate, AIUsageFlow claim authority, VerifiedProfile critical unknown blocking, LegalMatchingResult eligibility, citation allowlist, classification blocked/degraded/final taxonomy, readiness-only artifacts, report guardrails and audit/export redaction.

## Binding Negative-Test Checklist

Implementation stories derived from this epic artifact must include negative tests for:

- RBAC read/write/action/export denial on every protected surface, including Internal Legal Operator API/CLI, worker-triggered transitions and generated artifact downloads.
- Duplicate, retry, replay and DLQ handling for scan, technical profile, AIUsageFlow, reconciliation, legal matching, classification, gap analysis, document generation and audit export commands.
- Stale handoff rejection for TechnicalProfile, AIUsageFlow, VerifiedProfile, LegalMatchingResult, classification result, GapAnalysis and generated documents.
- Concurrent Manager approval, revoked Developer scope during task execution, corpus version supersession during classification, LLM budget exhaustion during retry, audit write failure after artifact generation and artifact download after revocation.
- Citation rejection for fabricated locators, wrong corpus version, stale effective date, parent-as-primary misuse, referenced-as-primary misuse and out-of-allowlist references.

## Stakeholder Outcomes and Decision Boundaries

- Manager outcome: understand what is known, what is missing, what is blocked and what next action is available without needing source-code expertise.
- Optional Developer outcome: view only assigned technical findings and repository/evidence tasks inside granted RBAC scope; Developer participation must not block the Manager golden path by default.
- Internal Legal Operator outcome: ingest, review and approve legal corpus versions through internal API/CLI or operations workflow; this is not customer-facing corpus administration.
- Legal or compliance reviewer outcome: inspect LegalRuleMatch evidence, citation provenance, rationale, confidence and coverage before classification relies on legal basis.
- Workspace owner or audit consumer outcome: see who viewed, changed, approved, generated, exported or was denied access to material artifacts, with correlation IDs and safe refs.
- LCSP supports compliance assessment and evidence traceability. It must not present final risk, compliance status, legal certainty or production readiness before the corresponding gates and guardrails pass.

### FR Coverage Map

FR-001: Epic 1 - Secure Workspace and RBAC-Scoped Collaboration.

FR-002: Epic 1 - Secure Workspace and RBAC-Scoped Collaboration.

FR-003: Epic 1 - Secure Workspace and RBAC-Scoped Collaboration.

FR-004: Epic 1 - Secure Workspace and RBAC-Scoped Collaboration.

FR-005: Epic 1 - Secure Workspace and RBAC-Scoped Collaboration.

FR-006: Epic 1 - Secure Workspace and RBAC-Scoped Collaboration.

FR-007: Epic 1 - Secure Workspace and RBAC-Scoped Collaboration.

FR-008: Epic 1 - Secure Workspace and RBAC-Scoped Collaboration.

FR-009: Epic 1 - Secure Workspace and RBAC-Scoped Collaboration.

FR-010: Epic 1 - Secure Workspace and RBAC-Scoped Collaboration.

FR-011: Epic 1 - Secure Workspace and RBAC-Scoped Collaboration.

FR-012: Epic 1 - Secure Workspace and RBAC-Scoped Collaboration.

FR-013: Epic 2 - Manager Assessment and Wizard Readiness.

FR-014: Epic 2 - Manager Assessment and Wizard Readiness.

FR-015: Epic 2 - Manager Assessment and Wizard Readiness.

FR-016: Epic 3 - Trusted Repository Evidence and TechnicalProfile.

FR-017: Epic 3 - Trusted Repository Evidence and TechnicalProfile.

FR-018: Epic 3 - Trusted Repository Evidence and TechnicalProfile.

FR-019: Epic 3 - Trusted Repository Evidence and TechnicalProfile.

FR-020: Epic 3 - Trusted Repository Evidence and TechnicalProfile.

FR-021: Epic 3 - Trusted Repository Evidence and TechnicalProfile.

FR-022: Epic 3 - Trusted Repository Evidence and TechnicalProfile.

FR-023: Epic 3 - Trusted Repository Evidence and TechnicalProfile.

FR-024: Epic 4 - AIUsageFlow Claims and Uncertainty.

FR-025: Epic 4 - AIUsageFlow Claims and Uncertainty.

FR-026: Epic 5 - Reconciliation and VerifiedProfile.

FR-027: Epic 5 - Reconciliation and VerifiedProfile.

FR-028: Epic 5 - Reconciliation and VerifiedProfile.

FR-029: Epic 5 - Reconciliation and VerifiedProfile.

FR-030: Epic 5 - Reconciliation and VerifiedProfile.

FR-031: Epic 5 - Reconciliation and VerifiedProfile.

FR-032: Epic 6 - Legal Corpus Retrieval and LegalRuleMatch Evidence.

FR-033: Epic 6 - Legal Corpus Retrieval and LegalRuleMatch Evidence.

FR-034: Epic 6 - Legal Corpus Retrieval and LegalRuleMatch Evidence.

FR-035: Epic 7 - Citation-Backed Classification.

FR-036: Epic 7 - Citation-Backed Classification.

FR-037: Epic 7 - Citation-Backed Classification.

FR-038: Epic 8 - Gap Analysis, Guarded Documents, and Audit Trail.

FR-039: Epic 8 - Gap Analysis, Guarded Documents, and Audit Trail.

FR-040: Epic 2 - Manager Assessment and Wizard Readiness.

FR-041: Epic 8 - Gap Analysis, Guarded Documents, and Audit Trail.

FR-042: Epic 8 - Gap Analysis, Guarded Documents, and Audit Trail.

FR-043: Epic 8 - Gap Analysis, Guarded Documents, and Audit Trail.

FR-044: Epic 8 - Gap Analysis, Guarded Documents, and Audit Trail.

FR-045: Cross-epic exclusion guardrail - structured-attestation disclosure is superseded and must not create active stories.

FR-046: Cross-epic exclusion guardrail - structured supplemental attestation is superseded and must not create active stories.

FR-047: Epic 1 - Secure Workspace and RBAC-Scoped Collaboration.

FR-048: Epic 3 - Trusted Repository Evidence and TechnicalProfile.

FR-049: Epic 3 - Trusted Repository Evidence and TechnicalProfile.

FR-050: Epic 3 - Trusted Repository Evidence and TechnicalProfile.

FR-051: Cross-epic exclusion guardrail - manual technical evidence JSON upload is removed from product scope and must not create active stories.

FR-052: Cross-epic deferred guardrail - delegated free-form clarification is Deferred/Post-MVP and must not create active MVP stories.

FR-053: Epic 6 - Legal Corpus Retrieval and LegalRuleMatch Evidence.

FR-054: Epic 6 - Legal Corpus Retrieval and LegalRuleMatch Evidence.

FR-055: Epic 7 - Citation-Backed Classification.

FR-056: Epic 6 - Legal Corpus Retrieval and LegalRuleMatch Evidence.

## Story-Level Coverage Map

| Story | Primary FR/control coverage |
| --- | --- |
| 1.1 Approved Account Entry and Workspace Access | FR-001, FR-002 |
| 1.2 MFA, Session, Recovery, and Profile Safety | FR-003, FR-004 |
| 1.3 OAuth/OIDC Login Without Repository Authorization | FR-005, FR-006 |
| 1.4 Organization Membership and Manager Policy Scope | FR-007, FR-008, FR-009 |
| 1.5 Optional Developer Invitation and Scoped Task Acceptance | FR-010, FR-011, FR-047 |
| 1.6 Manager-Only Action Enforcement | FR-012 |
| 1.7 RBAC Policy Runtime and Deny-on-Failure Contract | Cross-cutting RBAC control for FR-007..FR-012, FR-047 and NFR-008/NFR-009 |
| 1.8 Foundational Audit, Outbox, and Event Contract | Cross-cutting audit/event control for FR-042 and NFR-010/NFR-011/NFR-026 |
| 1.9 Python Worker Command and Event Platform Contract | Cross-cutting worker control for FR-018, FR-050 and async domain workloads |
| 2.1 Create Manager-Owned Assessment | FR-013 |
| 2.2 Complete WizardProfile in Business Language | FR-014 |
| 2.3 Wizard-Only Readiness Without Risk Level | FR-015 |
| 2.4 Wizard Readiness Export | FR-040 |
| 3.1 Connect Read-Only GitHub Repository | FR-016 |
| 3.2 Pin Commit and Create RepositorySnapshot | FR-017 |
| 3.3 Trusted Scan Trigger and Scan Job Orchestration | FR-018, FR-050 |
| 3.4 Static Scanner Workspace and Sandbox | FR-019 |
| 3.5 Static Scanner Toolchain Execution | FR-018, FR-023 |
| 3.6 Scan Failure Severity and Evidence Acceptance Policy | FR-018, FR-019, FR-021 |
| 3.7 TechnicalEvidenceReport Gates | FR-020, FR-021 |
| 3.8 TechnicalProfile Generation | FR-022, FR-023 |
| 3.9 Redacted Technical Findings Review and Developer Scoped View | FR-047, FR-048 |
| 3.10 Scan Re-run Without Mutating History | FR-049 |
| 3.11 Removed and Deferred Evidence Path Guardrails | FR-045, FR-046, FR-051, FR-052 negative/deferred guardrails |
| 4.1 Build AIUsageFlow From Wizard and Technical Evidence | FR-024 |
| 4.2 Preserve TechnicalProfile and AIUsageFlow Separation | FR-024 |
| 4.3 Evidence-Referenced AI Usage Claims | FR-024, FR-025 |
| 4.4 Unknown, Unclear, and Low-Confidence Usage Fields | FR-025 |
| 4.5 Conflict Candidate Detection for Reconciliation | FR-025, FR-026 |
| 4.6 AIUsageFlow Review Surface Without Final Authority | FR-024, FR-025 |
| 5.1 Detect Material Profile Conflicts | FR-026 |
| 5.2 Explain Conflict Score and Evidence Basis | FR-027 |
| 5.3 Manager Conflict Resolution | FR-028, FR-029 |
| 5.4 Preserve Scanner Evidence During Resolution | FR-029 |
| 5.5 Create VerifiedProfile After Gates Pass | FR-030 |
| 5.6 Manager Review and Approval of VerifiedProfile | FR-031 |
| 6.1 Ingest Official Legal Source Snapshot | FR-053 |
| 6.2 Parse Legal Structure and Stable Hierarchical IDs | FR-053, FR-056 |
| 6.3 Approve LegalCorpusVersion | FR-054 |
| 6.4 Build ChromaDB Structure-First Vectorless Legal Index | FR-056 |
| 6.5 Retrieve Primary, Parent, and Referenced Context | FR-032, FR-056 |
| 6.6 Enforce Retrieved and Context Citation Allowlist | FR-034, FR-056 |
| 6.7 Create LegalMatchingResult and LegalRuleMatch Evidence | FR-032, FR-033, FR-034 |
| 7.1 Submit Classification Request From Approved VerifiedProfile | FR-035 |
| 7.2 Apply Hard-Rule and LegalRuleMatch Precedence | FR-035, FR-036 |
| 7.3 Use Real LLM Provider With Schema and Budget Guardrails | FR-055 |
| 7.4 Reject Provider-Only or Unsupported Classification | FR-034, FR-055 |
| 7.5 Validate Classification Citations Against Legal Allowlist | FR-036 |
| 7.6 Present Classification, Blocked, or Degraded State | FR-036, FR-037 |
| 8.1 Generate GapAnalysis From Classification and Evidence | FR-038 |
| 8.2 Display Gap Analysis With Evidence and Priority | FR-038 |
| 8.3 Generate Guarded Final Report | FR-039 |
| 8.4 Generate Evidence Readiness Report When Final Evidence Is Missing | FR-040 |
| 8.5 Download Versioned Artifacts | FR-041, FR-044 |
| 8.6 Record Immutable Assessment Audit Trail | FR-042 |
| 8.7 View and Export Redacted Audit Trail | FR-043 |

## Final Validation Results

Validation date: 2026-06-25.

| Check | Result | Notes |
| --- | --- | --- |
| FR coverage | PASS | `FR-001..FR-056` are covered by active stories, explicit negative/deferred guardrails, or cross-cutting control stories. |
| Superseded/removed FR handling | PASS | `FR-045`, `FR-046`, `FR-051`, and `FR-052` remain negative/deferred guardrails and do not create active MVP journeys. |
| Starter template setup | PASS | No mandatory architecture starter template was found; no starter-template Story 1.1 is required. |
| Database/entity sequencing | PASS | Stories define domain artifacts at first use and do not require all tables/entities to be created upfront. |
| Story quality | PASS_WITH_GATES | Stories have acceptance criteria and story-level FR coverage. AC-level IDs and detailed trace rows are required before implementation readiness certification. |
| Epic structure | PASS | Epics deliver user-visible or operator-visible value and preserve the Manager golden path, optional Developer participation, and internal legal-operator boundary. |
| Dependency flow | PASS_WITH_GATES | Dependencies flow from workspace/RBAC through evidence, AIUsageFlow, VerifiedProfile, legal matching, classification, documents, and audit. Decision artifacts remain explicit pre-implementation gates. |
| Architecture compliance | PASS_WITH_GATES | RBAC, Python Worker Platform, scanner, ChromaDB vectorless retrieval, LegalMatchingResult, audit/outbox, and LLM guardrails are represented; implementation readiness still requires companion traceability and state-transition artifacts. |

Final validation status: `EPICS_AND_STORIES_READY_FOR_NEXT_WORKFLOW_STEP`.

## Epic List

### Epic 1: Secure Workspace and RBAC-Scoped Collaboration

Manager and optional Developer collaborators can authenticate, enter the correct organization workspace, and act only within tenant-scoped RBAC policy boundaries.

**FRs covered:** FR-001, FR-002, FR-003, FR-004, FR-005, FR-006, FR-007, FR-008, FR-009, FR-010, FR-011, FR-012, FR-047.

**Implementation notes:** This epic must establish identity/session/MFA/OAuth separation, organization membership, Manager policy templates, Developer scoped task acceptance and deny-by-default RBAC enforcement. It must carry audit and policy traceability acceptance constraints from the start.

### Epic 2: Manager Assessment and Wizard Readiness

Manager can create an assessment, complete WizardProfile in business/legal language, and receive readiness-only guidance before technical evidence without any risk label.

**FRs covered:** FR-013, FR-014, FR-015, FR-040.

**Implementation notes:** This epic owns the product-facing assessment start, WizardProfile capture, Wizard-only readiness state, no-risk-label guardrail, readiness-only export basis and Vietnamese/business-language UX constraints.

### Epic 3: Trusted Repository Evidence and TechnicalProfile

Manager or a RBAC-scoped Developer can connect a read-only GitHub repository, pin a commit, trigger or resume trusted static scan, review redacted findings, and produce a TechnicalEvidenceReport plus TechnicalProfile without mutating history.

**FRs covered:** FR-016, FR-017, FR-018, FR-019, FR-020, FR-021, FR-022, FR-023, FR-048, FR-049, FR-050, FR-051, FR-052.

**Implementation notes:** This epic owns repository connection, snapshot, scan lifecycle, scanner privacy/cleanup, evidence schema/privacy/quality gates, redacted findings, TechnicalProfile creation, scan reruns and trusted trigger mapping. FR-051 and FR-052 are covered only as explicit negative/deferred guardrails. No manual technical evidence JSON upload, Local/CI report upload as an MVP evidence path, structured attestation or delegated free-form clarification screen may be created.

### Epic 4: AIUsageFlow Claims and Uncertainty

LCSP creates AIUsageFlow from TechnicalProfile trace and TechnicalEvidenceReport claims with evidence refs, confidence, uncertainty and conflict candidates. This epic answers how AI is used in the business process; it does not replace TechnicalProfile and does not create VerifiedProfile.

**FRs covered:** FR-024, FR-025.

**Implementation notes:** This epic is intentionally separate from TechnicalProfile and reconciliation. TechnicalProfile answers what the scan found technically. AIUsageFlow translates those facts plus Manager declarations into evidence-backed business-meaning claims. It must preserve unknown/unclear fields, abstain from provider-only claims, attach evidence refs to material claims and hand off conflict candidates to reconciliation.

### Epic 5: Reconciliation and VerifiedProfile

LCSP compares WizardProfile, TechnicalProfile and AIUsageFlow, creates Manager-resolvable conflicts when material differences exist, and produces VerifiedProfile only after gates and conflict resolution are complete.

**FRs covered:** FR-026, FR-027, FR-028, FR-029, FR-030, FR-031.

**Implementation notes:** This epic owns conflict detection, explanatory Conflict Score, Manager conflict resolution, immutable scanner evidence preservation, VerifiedProfile creation and review/approval. Reconciliation creates VerifiedProfile; AIUsageFlow does not.

### Epic 6: Legal Corpus Retrieval and LegalRuleMatch Evidence

Internal legal operations can ingest and approve immutable LegalCorpusVersion, and LCSP can produce LegalRuleMatch through ChromaDB structure-first vectorless retrieval with primary, parent and referenced context plus citation allowlist validation.

**FRs covered:** FR-032, FR-033, FR-034, FR-053, FR-054, FR-056.

**Implementation notes:** This epic includes internal API/CLI or operations workflow for source snapshot ingestion and LegalCorpusVersion approval, not a customer-facing corpus admin UX. ChromaDB structure-first vectorless retrieval is the technical constraint, while the epic outcome is auditable LegalRuleMatch evidence. It owns stable hierarchical IDs, Clause/Point parent-context assembly, one-hop xref expansion, retrieval `context_role` values (`PRIMARY_MATCH`, `PARENT_CONTEXT`, `REFERENCED_CONTEXT`), citation coverage and out-of-allowlist rejection.

### Epic 7: Citation-Backed Classification

Manager receives a risk classification result or an explicit blocked/degraded state based on VerifiedProfile, LegalRuleMatch, citation coverage, real LLM provider guardrails and hard-rule precedence.

**FRs covered:** FR-035, FR-036, FR-037, FR-055.

**Implementation notes:** This epic owns classification request/status/result UX and worker behavior, real LLM provider and budget controls, schema/model-output guardrails, hard-rule precedence, no provider-only classification, and blocked/degraded states when legal match, citation or unknown critical usage is insufficient.

### Epic 8: Gap Analysis, Guarded Documents, and Audit Trail

Manager can review gap analysis, generate final reports or readiness-only exports under output guardrails, download artifacts, and inspect/export the redacted audit trail for the assessment.

**FRs covered:** FR-038, FR-039, FR-040, FR-041, FR-042, FR-043, FR-044.

**Implementation notes:** This epic owns GapAnalysis, guarded document generation, object artifact status/download, readiness-only export, immutable artifact versioning, audit event writing, redacted audit table/export and report overclaim prevention. Audit event creation is also an acceptance constraint across earlier epics.

## Epic 1: Secure Workspace and RBAC-Scoped Collaboration

Manager and optional Developer collaborators can authenticate, enter the correct organization workspace, and act only within tenant-scoped RBAC policy boundaries.

### Story 1.1: Approved Account Entry and Workspace Access

As a user,
I want to register or enter LCSP through an approved authentication path,
So that I can access only the workspace I am authorized to use.

**Acceptance Criteria:**

**Given** a user has an approved account or invitation
**When** the user registers or signs in with valid credentials
**Then** LCSP creates an authenticated session scoped to the correct user identity
**And** workspace access is denied until organization membership is confirmed
**And** invalid credentials, invalid invite state, or missing membership are rejected with a safe error contract
**And** the contract exposes stable keys for user-facing title, detail, and next action
**And** Web renders the final blocked-state copy from those keys
**And** an audit event records success or failure without secrets.

**Given** a user attempts to access a protected workspace without authentication
**When** the request reaches Web/API
**Then** LCSP blocks access and routes the user to the approved sign-in flow
**And** no workspace data is returned.

### Story 1.2: MFA, Session, Recovery, and Profile Safety

As a workspace user,
I want MFA, session, recovery, and safe profile controls,
So that account access remains protected after login.

**Acceptance Criteria:**

**Given** MFA is required for the user or organization
**When** the user signs in
**Then** LCSP requires valid MFA verification before workspace access
**And** invalid, expired, replayed, or rate-limited OTP attempts are rejected
**And** MFA secret material is not persisted or logged in plaintext.

**Given** a session is expired or revoked
**When** the user calls a protected route
**Then** LCSP denies the request and shows a safe recovery or sign-in action
**And** the denial is audited.

**Given** the user updates profile or recovery settings
**When** the update succeeds or fails
**Then** LCSP records a safe audit event
**And** no secret values appear in logs, audit, UI, or API response.

### Story 1.3: OAuth/OIDC Login Without Repository Authorization

As a user,
I want OAuth/OIDC login to authenticate only my LCSP identity,
So that signing in does not accidentally grant repository scan access.

**Acceptance Criteria:**

**Given** an OAuth/OIDC provider is configured
**When** the user completes provider login
**Then** LCSP validates redirect URI, state, nonce, issuer, audience, expiry, and safe account linking
**And** LCSP creates only LCSP identity/session state
**And** no GitHub RepositoryConnection, repository token, or scan permission is created.

**Given** an OAuth/OIDC callback is invalid or unsafe
**When** LCSP receives the callback
**Then** the callback is rejected
**And** the user receives a safe error contract with stable keys for title, detail, and next action
**And** Web renders the final failure copy from those keys
**And** an audit event records the failure reason without tokens.

### Story 1.4: Organization Membership and Manager Policy Scope

As a Manager,
I want LCSP to recognize my organization and Manager policy scope,
So that I can start and own assessments without receiving unauthorized powers.

**Acceptance Criteria:**

**Given** an authenticated user belongs to an organization
**When** the user enters the workspace
**Then** LCSP displays the active organization/workspace context
**And** RBAC evaluates workspace-scoped actions using actor identity, organization, resource, action, subject attributes, policy, and policy version.

**Given** the user has Manager policy scope for an organization
**When** the user opens Manager workspace actions
**Then** LCSP allows only actions granted by RBAC and current state gates
**And** denied actions are hidden where appropriate or blocked with safe explanation
**And** allow/deny decisions are audited with policy ID/version and correlation ID.

### Story 1.5: Optional Developer Invitation and Scoped Task Acceptance

As a Manager,
I want to invite a Developer with a scoped RBAC task,
So that the Developer can help without becoming required for the Manager golden path.

**Acceptance Criteria:**

**Given** a Manager owns an assessment or workspace context
**When** the Manager invites a Developer
**Then** LCSP creates an invitation with organization, assessment/task scope, expiry, allowed actions, and policy version
**And** the invitation does not grant Manager-only actions.

**Given** an invited Developer opens the task
**When** the Developer accepts a valid invitation
**Then** LCSP shows granted RBAC scope, expiry/revocation state, hidden data boundaries, and assigned task context
**And** Developer can access only assigned task surfaces
**And** Manager flow remains available without Developer participation.

**Given** an invitation is expired, revoked, wrong-organization, or outside policy scope
**When** the Developer attempts access
**Then** LCSP denies access with safe explanation
**And** no assessment data outside scope is returned
**And** the denial is audited.

### Story 1.6: Manager-Only Action Enforcement

As a Manager,
I want Manager-only actions protected from Developer access,
So that final assessment authority stays with the accountable Manager.

**Acceptance Criteria:**

**Given** a Developer has accepted a scoped task
**When** the Developer attempts to edit Wizard answers, finalize conflict resolution, approve VerifiedProfile, run final classification, generate final report, export compliance dossier, change Manager decisions, invite users, or manage assessment settings
**Then** LCSP denies the action server-side
**And** the UI does not present the action as available when policy/state is known
**And** the denial is audited with actor, action, resource, result, policy version, and correlation ID.

**Given** a Manager has valid policy and state gates allow the action
**When** the Manager performs a Manager-only action
**Then** LCSP permits the action
**And** the action is auditable and tenant-scoped.

### Story 1.7: RBAC Policy Runtime and Deny-on-Failure Contract

As LCSP,
I want a canonical RBAC runtime contract before feature workflows depend on policy decisions,
So that authorization behavior is consistent across Web, API, and worker-triggered domain actions.

**Acceptance Criteria:**

**Given** RBAC policies are loaded for an organization
**When** LCSP evaluates a protected action
**Then** the decision uses actor, organization, resource, action, subject attributes, policy ID, policy version, and state gates
**And** records allow/deny outcome, reason code, policy version, and correlation ID.

**Given** policy storage, cache, policy engine, or attribute lookup is unavailable
**When** a protected action is evaluated
**Then** LCSP denies by default unless the action is explicitly classified as safe public access
**And** records a degraded authorization event without leaking policy internals.

**Given** RBAC policies change or migrate
**When** new policy versions are activated
**Then** LCSP preserves prior policy versions for historical audit
**And** invalidates or refreshes caches according to the policy version contract.

### Story 1.8: Foundational Audit, Outbox, and Event Contract

As LCSP,
I want a foundational audit and outbox contract for material domain transitions,
So that downstream workers and audit views share consistent event semantics.

**Acceptance Criteria:**

**Given** a material domain transition occurs
**When** LCSP commits the domain change
**Then** it writes the domain state, audit event, and outbox event transactionally where supported
**And** includes event name, schema version, aggregate ID, organization ID, assessment ID where applicable, correlation ID, causation ID, actor, result, and redaction status.

**Given** an event payload contains secrets, raw source, full prompts, repository tokens, or out-of-scope tenant data
**When** audit or outbox payload is built
**Then** LCSP redacts or omits unsafe fields
**And** stores only approved metadata, hashes, and safe references.

**Given** audit or outbox write fails for a required material transition
**When** LCSP evaluates the operation
**Then** LCSP blocks, retries, or marks the operation degraded according to the domain failure policy
**And** never silently drops required audit evidence.

### Story 1.9: Python Worker Command and Event Platform Contract

As LCSP,
I want a shared Python Worker Platform command and event contract,
So that scan, profile, reconciliation, legal, classification, gap, document, and audit-export workers behave consistently.

**Acceptance Criteria:**

**Given** a domain worker consumes a command
**When** the command is accepted
**Then** LCSP validates command name, schema version, aggregate IDs, organization scope, assessment scope where applicable, idempotency key, correlation ID, causation ID, retry metadata, and actor or system principal.

**Given** a worker handles a command
**When** it locks work and writes results
**Then** LCSP uses canonical inbox/outbox persistence, idempotency semantics, lease/lock timeout, retry budget, dead-letter behavior, and replay-safe result handling.

**Given** a command cannot be processed after retry budget or validation failure
**When** it enters DLQ or operator recovery
**Then** LCSP records reason, retry count, last error class, safe recovery action, and audit event
**And** no worker creates duplicate accepted domain artifacts during replay.

### Story 1.10: TypeScript Contract, Localization, and Import Boundary Governance

As a developer,
I want authentication and workspace-facing shared modules to use typed public contracts and enforced import boundaries,
So that Web/API can share stable behavior without source-path coupling or copy drift.

**Acceptance Criteria:**

**Given** shared auth, workspace, and localization modules are used across apps and packages
**When** a developer imports contracts, copy keys, or resolvers
**Then** the import uses approved public package or app exports
**And** direct source-path imports, forbidden self-import patterns, and disallowed workspace-relative imports are rejected by repository validation

**Given** auth and blocked-state contracts are shared between API and Web
**When** the contracts are changed
**Then** TypeScript validation fails if API and Web drift on the contract shape
**And** tests cover the stable key-based blocked-state behavior across the shared boundary

## Epic 2: Manager Assessment and Wizard Readiness

Manager can create an assessment, complete WizardProfile in business/legal language, and receive readiness-only guidance before technical evidence without any risk label.

### Story 2.1: Create Manager-Owned Assessment

As a Manager,
I want to create an assessment in my organization workspace,
So that I can start an evidence-based LCSP workflow for one AI-enabled system.

**Acceptance Criteria:**

**Given** an authenticated Manager has RBAC permission to create assessments
**When** the Manager enters basic assessment identity and context
**Then** LCSP creates a Manager-owned assessment in the active organization
**And** the assessment starts in a pre-Wizard state or `WIZARD_IN_PROGRESS`
**And** the assessment records owner, organization, creation timestamp, and audit event
**And** no Developer is required to create or continue the assessment.

**Given** the Manager lacks permission or workspace scope is missing
**When** the Manager attempts to create an assessment
**Then** LCSP denies the action with a safe explanation
**And** no assessment is created
**And** the denial is audited.

### Story 2.2: Complete WizardProfile in Business Language

As a Manager,
I want to answer WizardProfile questions in business/legal language,
So that LCSP captures assessment facts without requiring source-code expertise.

**Acceptance Criteria:**

**Given** a Manager-owned assessment exists
**When** the Manager completes Wizard questions for purpose, sector, data type, user group, user impact, decision role, human oversight, external LLM usage, and biometric/high-impact indicators
**Then** LCSP saves a WizardProfile version linked to the assessment
**And** each critical answer maps to a structured WizardProfile field
**And** questions avoid unexplained code-centric terms
**And** complex questions include examples or progressive disclosure.

**Given** required critical fields are missing or invalid
**When** the Manager attempts to submit the WizardProfile
**Then** LCSP blocks submission with business-language validation messages
**And** no risk/severity/non-compliant wording is shown
**And** draft state is preserved where safe.

### Story 2.3: Wizard-Only Readiness Without Risk Level

As a Manager,
I want readiness guidance after Wizard submission when technical evidence is missing,
So that I know the next required actions without seeing unsupported risk classification.

**Acceptance Criteria:**

**Given** WizardProfile is submitted and no accepted technical evidence exists
**When** the Manager views assessment overview
**Then** LCSP shows readiness-only state, missing evidence checklist, next action, and blocker reason
**And** LCSP does not show HIGH/MEDIUM/LOW, risk, severity, violation, non-compliant, or equivalent authoritative labels
**And** classification remains locked with `LOCKED_EVIDENCE_REQUIRED` or equivalent neutral status
**And** the UI explains that repository evidence is required before classification.

**Given** technical evidence later becomes available
**When** the Manager returns to the assessment overview
**Then** readiness state updates without mutating the original WizardProfile version
**And** the transition is auditable.

### Story 2.4: Wizard Readiness Export

As a Manager,
I want to generate a Wizard Readiness Export before technical evidence is available,
So that I can share preparation gaps without implying legal classification.

**Acceptance Criteria:**

**Given** WizardProfile is submitted and classification is locked for missing technical evidence
**When** the Manager requests Wizard Readiness Export from the Wizard or assessment readiness entry point
**Then** LCSP generates an export labeled `Wizard Readiness Export` and readiness-only in title, badge, preview, metadata, artifact history, and download state
**And** the export includes missing evidence checklist and preliminary preparation guidance
**And** the export contains no HIGH/MEDIUM/LOW, final risk, legal conclusion, compliance certification, or non-compliant wording
**And** the generated artifact has version, timestamp, owner, assessment ID, and audit event.

**Given** export generation text attempts to imply legal conclusion or final classification
**When** output guardrails evaluate the export
**Then** LCSP blocks generation or removes the overclaim
**And** records a safe blocked/guardrail audit event.

## Epic 3: Trusted Repository Evidence and TechnicalProfile

Manager or RBAC-scoped Developer can connect a read-only GitHub repository, pin a commit, trigger or resume trusted static scan, review redacted findings, and produce TechnicalEvidenceReport plus TechnicalProfile without mutating history.

### Story 3.1: Connect Read-Only GitHub Repository

As a Manager or scoped Developer,
I want to connect an authorized GitHub repository read-only,
So that LCSP can collect trusted technical evidence without granting write access.

**Acceptance Criteria:**

**Given** the actor has RBAC permission to connect a repository for the assessment
**When** the actor starts GitHub App repository connection
**Then** LCSP requests only read-only repository permissions required for trusted scan
**And** the actor can select only authorized repositories and branches
**And** LCSP stores RepositoryConnection metadata without exposing raw tokens in UI, logs, audit, or API responses
**And** the Manager can complete repository connection without assigning a Developer.

**Given** OAuth/OIDC login exists for LCSP identity
**When** the actor signs in through OAuth/OIDC
**Then** LCSP does not treat identity login as repository authorization
**And** no RepositoryConnection or scan permission is created until GitHub App connection is completed.

**Given** repository authorization is revoked, invalid, wrong-organization, or outside RBAC scope
**When** LCSP validates the connection or receives a repository action
**Then** LCSP blocks the action with a safe explanation
**And** no repository content is scanned
**And** the denial is audited.

### Story 3.2: Pin Commit and Create RepositorySnapshot

As a Manager or scoped Developer,
I want to pin a branch or commit snapshot,
So that all scan evidence is tied to an immutable repository state.

**Acceptance Criteria:**

**Given** a valid RepositoryConnection exists
**When** the actor selects a branch, ref, or commit for scan
**Then** LCSP resolves and records immutable RepositorySnapshot metadata including repository ID, ref, commit SHA, provider metadata, actor, timestamp, and assessment ID
**And** downstream scan jobs reference the snapshot instead of mutable branch state
**And** the Manager can pin the snapshot without assigning a Developer.

**Given** the requested ref or commit cannot be resolved, is outside connection scope, or provider validation fails
**When** the actor attempts to create a snapshot
**Then** LCSP blocks snapshot creation with a safe explanation
**And** no scan job is queued
**And** the failure is audited.

**Given** source files are temporarily materialized for scan
**When** the snapshot operation completes or fails
**Then** LCSP retains only approved metadata and evidence artifacts
**And** raw source is not persisted long-term outside the restricted scanner workspace.

### Story 3.3: Trusted Scan Trigger and Scan Job Orchestration

As LCSP,
I want trusted scan initiation with idempotent job orchestration,
So that duplicate, retry, out-of-order, and replay paths do not create inconsistent evidence.

**Acceptance Criteria:**

**Given** a repository snapshot exists and assessment state permits technical scan
**When** a trusted trigger or Manager action requests scan
**Then** LCSP creates or resumes a RepositoryScanJob with assessment ID, snapshot ID, trigger source, idempotency key, state, attempt count, and correlation ID
**And** valid duplicate requests return the existing job or safe resume state.

**Given** repository mapping or assessment context is incomplete
**When** a scan trigger is received
**Then** LCSP transitions to a controlled state such as `PENDING_MAPPING`, `BLOCKED_MAPPING`, `WAITING_FOR_CONTEXT`, or `READY_TO_SNAPSHOT`
**And** the Manager sees the required next action without risk or legal classification wording.

**Given** duplicate, retry, out-of-order, or replayed scan commands occur
**When** the worker or API processes them
**Then** LCSP applies idempotency and state validation
**And** creates no duplicate accepted evidence chain
**And** records audit and queue outcome.

**Given** scan commands are persisted through the worker platform
**When** retries, DLQ, or operator replay are required
**Then** LCSP applies the canonical outbox owner, retry budget, DLQ reason codes, replay authority, and operator recovery rules
**And** no replay can mutate prior accepted TechnicalEvidenceReport or TechnicalProfile versions.

### Story 3.4: Static Scanner Workspace and Sandbox

As LCSP,
I want the Python scanner worker to materialize snapshots in a restricted workspace,
So that scan input is isolated and cleaned up without leaking source or secrets.

**Acceptance Criteria:**

**Given** a RepositoryScanJob is ready
**When** the Python scanner worker locks the job
**Then** it materializes the pinned snapshot in a restricted temporary workspace
**And** records workspace ID, snapshot ID, worker lease, start time, and cleanup policy
**And** does not persist raw source outside the restricted workspace.

**Given** scanner execution is in progress
**When** project code would require install, build, test, Docker execution, endpoint probing, or arbitrary runtime execution
**Then** the scanner does not perform that action
**And** records the limitation as unsupported or coverage-limited evidence.

**Given** scan workspace processing completes, fails, or times out
**When** cleanup runs
**Then** LCSP verifies temporary workspace cleanup
**And** records cleanup status and any safe residual cleanup action.

### Story 3.5: Static Scanner Toolchain Execution

As LCSP,
I want the scanner worker to run the approved bounded static toolchain,
So that technical evidence is collected with known tool versions, configuration, and coverage limits.

**Acceptance Criteria:**

**Given** a RepositoryScanJob is locked in a restricted workspace
**When** scanner execution starts
**Then** LCSP runs approved bounded static analysis tools including Syft, Knip, deptry, Python `ast`/`libcst`, `ts-morph`, tree-sitter/custom parser, and Semgrep as applicable by repository language profile
**And** records tool versions, config hash, ruleset hash, start/end time, language profile, and coverage limitations.

**Given** a repository language profile does not support a tool
**When** the scanner builds the execution plan
**Then** LCSP skips the unsupported tool with an explicit coverage limitation
**And** does not treat the skip as successful evidence for that capability.

### Story 3.6: Scan Failure Severity and Evidence Acceptance Policy

As LCSP,
I want scanner failures and partial results classified by a canonical severity policy,
So that downstream evidence gates know whether results are usable, insufficient, or terminal.

**Acceptance Criteria:**

**Given** a tool fails, times out, or returns partial results
**When** the scan completes or terminates
**Then** LCSP classifies the outcome as accepted-with-limitation, insufficient, retryable failure, or terminal scan failure according to the scanner severity table
**And** records tool failure class, retryability, severity, and downstream evidence eligibility
**And** no raw source, secrets, full prompts, or full AST dumps are persisted in evidence artifacts.

**Given** the scanner severity table, pinned tool failure policy, config hash policy, or ruleset hash policy is not approved
**When** implementation readiness is evaluated
**Then** scan evidence implementation remains blocked
**And** TechnicalEvidenceReport cannot be marked production-ready.

### Story 3.7: TechnicalEvidenceReport Gates

As LCSP,
I want schema, provenance, privacy, and quality gates for TechnicalEvidenceReport,
So that only accepted trusted evidence can feed downstream profiles.

**Acceptance Criteria:**

**Given** scanner outputs are available
**When** LCSP builds a TechnicalEvidenceReport
**Then** the report includes required schema fields, snapshot provenance, tool versions, config hash, ruleset hash, finding references, confidence, privacy flags, coverage limitations, report hash, and generation timestamp.

**Given** TechnicalEvidenceReport contains raw source, secrets, full prompts, unsafe identifiers, schema-invalid data, or missing required provenance
**When** evidence gates run
**Then** LCSP rejects the report for downstream use
**And** records a safe gate failure audit event.

**Given** evidence passes schema and privacy gates
**When** quality gates evaluate sufficiency
**Then** LCSP marks the evidence ready or insufficient with explicit reasons
**And** downstream TechnicalProfile generation can proceed only from accepted evidence.

### Story 3.8: TechnicalProfile Generation

As LCSP,
I want to generate TechnicalProfile from accepted scanner evidence,
So that downstream flows know what was technically observed without confusing it with AIUsageFlow or legal classification.

**Acceptance Criteria:**

**Given** an accepted TechnicalEvidenceReport exists
**When** TechnicalProfile generation runs
**Then** LCSP creates an evidence-derived TechnicalProfile with AI detection indicators, providers, frameworks, model invocation count or ranges, input and output categories, decision-flow signals, human-review signals, coverage limitations, confidence, and evidence references.

**Given** a material TechnicalProfile dimension cannot be determined from accepted evidence
**When** LCSP generates the profile
**Then** LCSP marks the dimension as unknown, low-confidence, or coverage-limited
**And** does not infer unsupported facts from Manager statements alone.

**Given** downstream workflows consume TechnicalProfile
**When** they build AIUsageFlow, reconciliation, legal matching, or classification inputs
**Then** TechnicalProfile remains technical evidence only
**And** it is not treated as AIUsageFlow, VerifiedProfile, risk level, legal conclusion, or compliance status.

**Handoff Contract:** Producer: scanner evidence domain. Consumer: AIUsageFlow and reconciliation domains. Artifact: `TechnicalProfile` with version, TechnicalEvidenceReport ref, assessment ID, organization ID, confidence, evidence refs, coverage limitations, validation gate status, audit event, and failure behavior for insufficient or stale evidence.

### Story 3.9: Redacted Technical Findings Review and Developer Scoped View

As a Manager or scoped Developer,
I want to review redacted technical findings, confidence, evidence refs, and coverage limitations,
So that I can understand evidence without exposing raw source, secrets, prompts, or out-of-scope data.

**Acceptance Criteria:**

**Given** accepted technical evidence exists
**When** Manager opens technical findings
**Then** LCSP shows redacted finding summaries, finding type, affected component reference, evidence references, confidence, coverage limitations, and scan version
**And** it does not expose raw source, secrets, full prompts, or full AST dumps.

**Given** a Developer has a scoped task assignment
**When** the Developer opens technical findings
**Then** LCSP shows only assigned or permitted finding surfaces
**And** hides Manager-only controls and out-of-scope assessment data
**And** all access is RBAC-evaluated and audited.

**Given** a Developer has assigned repository or findings tasks
**When** the Developer opens the workspace
**Then** LCSP shows assigned task list, due or expiry state, permitted actions, task completion action, and handback status to the Manager
**And** the Manager workspace shows that Developer participation is optional and no Developer assignment is required to continue the Manager golden path.

**Given** Developer scope is revoked or expires while a task is open
**When** the Developer attempts to continue, complete, download, or hand back the task
**Then** LCSP denies the action server-side, refreshes the task state, hides out-of-scope data, and audits the denial.

**Given** an actor lacks permission for a finding or assessment
**When** the actor requests technical evidence
**Then** LCSP denies access server-side
**And** returns a safe explanation without leaking whether hidden evidence exists.

### Story 3.10: Scan Re-run Without Mutating History

As a Manager or scoped actor,
I want to rerun scans as new immutable evidence versions,
So that improved evidence does not overwrite prior assessment history.

**Acceptance Criteria:**

**Given** an assessment already has a scan job, TechnicalEvidenceReport, or TechnicalProfile
**When** an authorized actor requests a scan rerun
**Then** LCSP creates a new RepositoryScanJob and new evidence/profile version chain
**And** previous snapshot, evidence report, TechnicalProfile, audit events, and artifact hashes remain immutable
**And** the Manager can request rerun without assigning a Developer.

**Given** a rerun uses the same snapshot and valid idempotency key
**When** duplicate rerun requests are received
**Then** LCSP safely resumes or returns the existing rerun job
**And** does not create duplicate accepted evidence.

**Given** users view scan history
**When** multiple scan versions exist
**Then** LCSP displays version, snapshot, status, timestamp, trigger source, and current/downstream usage state
**And** audit trail preserves each transition.

### Story 3.11: Removed and Deferred Evidence Path Guardrails

As LCSP,
I want removed and deferred evidence paths blocked or absent,
So that MVP cannot use manual technical evidence JSON, Local/CI report upload, structured attestation, or delegated free-form clarification as active evidence paths.

**Acceptance Criteria:**

**Given** a user searches UI or API for manual technical evidence JSON upload
**When** the request targets MVP evidence collection
**Then** LCSP does not expose an active upload path
**And** any stale or unsupported endpoint is absent or denied with safe explanation
**And** the action cannot create accepted technical evidence.

**Given** a user attempts Local/CI scanner report upload
**When** LCSP handles the request
**Then** LCSP treats Local/CI report upload as superseded or deferred outside active MVP
**And** it cannot feed TechnicalEvidenceReport, TechnicalProfile, classification, or final report.

**Given** a user attempts structured attestation or delegated free-form technical clarification
**When** LCSP handles the request
**Then** LCSP rejects or hides the path as removed/deferred for active MVP
**And** no role-bound claims, signed attestation, or free-form clarification answer becomes trusted technical evidence.

## Epic 4: AIUsageFlow Claims and Uncertainty

LCSP creates AIUsageFlow from TechnicalProfile trace and TechnicalEvidenceReport claims with evidence refs, confidence, uncertainty, and conflict candidates. This epic answers how AI is used in the business process; it does not replace TechnicalProfile and does not create VerifiedProfile.

### Story 4.1: Build AIUsageFlow From Wizard and Technical Evidence

As LCSP,
I want to build AIUsageFlow from WizardProfile, TechnicalProfile, and accepted TechnicalEvidenceReport,
So that AI usage is represented as business-process claims grounded in evidence.

**Acceptance Criteria:**

**Given** a submitted WizardProfile and accepted TechnicalProfile exist
**When** AIUsageFlow generation runs
**Then** LCSP creates AIUsageFlow claims for business process, AI purpose, input categories, output categories, downstream action, affected subjects, human review, automation level, harm categories, and evidence summary
**And** each material generated claim includes source profile refs, evidence or declaration refs, confidence, and uncertainty reason.

**Given** required evidence for AIUsageFlow is unavailable
**When** generation runs
**Then** LCSP does not create unsupported authoritative claims
**And** marks the missing dimensions as unknown, unclear, or pending evidence
**And** records generation status and audit event.

### Story 4.2: Preserve TechnicalProfile and AIUsageFlow Separation

As LCSP,
I want AIUsageFlow to remain separate from TechnicalProfile,
So that technical scanner observations are not confused with business usage interpretation.

**Acceptance Criteria:**

**Given** TechnicalProfile contains evidence-derived technical observations
**When** AIUsageFlow consumes TechnicalProfile
**Then** LCSP treats TechnicalProfile as an input source only
**And** preserves the original TechnicalProfile version, evidence refs, confidence, and coverage limitations.

**Given** AIUsageFlow is created or updated
**When** downstream workflows read it
**Then** LCSP identifies it as interpreted AI usage claims
**And** does not treat it as raw scanner evidence, VerifiedProfile, risk level, legal conclusion, or compliance status.

**Given** a claim depends on both Manager declaration and technical observation
**When** LCSP stores the claim
**Then** the claim records both source types separately
**And** does not overwrite either source profile.

### Story 4.3: Evidence-Referenced AI Usage Claims

As LCSP,
I want each material AIUsageFlow claim to include evidence refs and confidence,
So that downstream reconciliation can inspect why the claim exists.

**Acceptance Criteria:**

**Given** LCSP generates a material AIUsageFlow claim
**When** the claim is stored
**Then** the claim includes source refs, evidence refs where available, confidence, generation method, profile versions, and timestamp.

**Given** a claim is based only on Manager declaration
**When** LCSP stores the claim
**Then** LCSP marks the claim as declaration-backed
**And** does not imply scanner confirmation.

**Given** a claim is based on technical evidence
**When** LCSP stores the claim
**Then** LCSP links to the accepted TechnicalEvidenceReport or TechnicalProfile ref
**And** preserves related coverage limitations.

### Story 4.4: Unknown, Unclear, and Low-Confidence Usage Fields

As LCSP,
I want uncertain AI usage fields to remain unknown or low-confidence,
So that the system does not invent unsupported usage facts.

**Acceptance Criteria:**

**Given** AIUsageFlow generation cannot determine a material usage dimension
**When** LCSP evaluates the dimension
**Then** LCSP records `UNKNOWN`, `UNCLEAR`, or low-confidence state with reason
**And** avoids substituting defaults that imply factual certainty.

**Given** provider or framework evidence exists without usage context
**When** LCSP generates AIUsageFlow
**Then** LCSP does not infer downstream decision role, human review, affected subjects, or harm category from provider presence alone.

**Given** uncertainty affects downstream readiness
**When** Manager views the assessment
**Then** LCSP explains the missing or unclear dimension in business language
**And** does not show final risk or legal classification based only on uncertain AIUsageFlow.

### Story 4.5: Conflict Candidate Detection for Reconciliation

As LCSP,
I want AIUsageFlow generation to identify material conflicts between Manager declarations and technical evidence,
So that reconciliation can create Manager-resolvable conflict tasks.

**Acceptance Criteria:**

**Given** WizardProfile and TechnicalProfile disagree on a material AI usage dimension
**When** AIUsageFlow generation evaluates the dimension
**Then** LCSP records a conflict candidate with conflicting source refs, affected claim, confidence, and explanation
**And** does not resolve the conflict automatically.

**Given** a conflict candidate exists
**When** downstream reconciliation runs
**Then** LCSP can create a Manager-resolvable conflict task from the candidate
**And** preserves the original WizardProfile, TechnicalProfile, and AIUsageFlow versions.

**Given** a disagreement is low materiality or caused by known coverage limitation
**When** LCSP evaluates it
**Then** LCSP records uncertainty or coverage limitation rather than forcing a conflict task.

### Story 4.6: AIUsageFlow Review Surface Without Final Authority

As a Manager,
I want to review AIUsageFlow claims and uncertainty,
So that I can understand the interpreted AI usage before reconciliation without seeing it as final legal classification.

**Acceptance Criteria:**

**Given** AIUsageFlow has been generated
**When** Manager views the AI usage review surface
**Then** LCSP shows claim summaries, source refs, confidence, unknown fields, conflict candidates, and evidence availability
**And** distinguishes declaration-backed claims from scanner-backed claims.

**Given** AIUsageFlow is incomplete, uncertain, or conflict-bearing
**When** Manager reviews it
**Then** LCSP shows neutral next-action guidance
**And** does not present final risk, legal conclusion, compliance status, or VerifiedProfile approval.

**Given** a Developer has scoped access to technical evidence only
**When** the Developer requests AIUsageFlow review
**Then** LCSP applies RBAC to hide Manager-only review actions and out-of-scope business declarations
**And** audits access.

**Handoff Contract:** Producer: AIUsageFlow generation domain. Consumer: reconciliation domain. Artifact: `AIUsageFlow` with version, WizardProfile ref, TechnicalProfile ref, TechnicalEvidenceReport refs, claim IDs, claim source refs, confidence, uncertainty reasons, conflict candidates, RBAC scope, audit event, validation gate status, and failure behavior for unsupported material claims.

## Epic 5: Reconciliation and VerifiedProfile

LCSP compares WizardProfile, TechnicalProfile, and AIUsageFlow, creates Manager-resolvable conflicts when material differences exist, and produces VerifiedProfile only after gates and conflict resolution are complete.

### Story 5.1: Detect Material Profile Conflicts

As LCSP,
I want to compare WizardProfile, TechnicalProfile, and AIUsageFlow,
So that material inconsistencies are detected before classification.

**Acceptance Criteria:**

**Given** WizardProfile, TechnicalProfile, and AIUsageFlow versions exist for an assessment
**When** reconciliation runs
**Then** LCSP compares material dimensions including AI purpose, input/output categories, affected subjects, decision role, human review, external LLM usage, biometric/high-impact indicators, and technical evidence confidence
**And** records conflict candidates or no-conflict decisions with source refs and version IDs.

**Given** a material dimension is missing from one source
**When** reconciliation evaluates the dimension
**Then** LCSP records missing evidence or unknown state
**And** does not infer the missing value as agreed.

**Given** a conflict is below materiality threshold or explained by known coverage limitation
**When** reconciliation evaluates it
**Then** LCSP records the reason
**And** avoids creating unnecessary Manager conflict tasks.

### Story 5.2: Explain Conflict Score and Evidence Basis

As a Manager,
I want conflict score and conflict explanations,
So that I understand which differences require review and why.

**Acceptance Criteria:**

**Given** reconciliation identifies one or more material conflicts
**When** Manager opens the reconciliation view
**Then** LCSP shows each conflict with affected field, source values, evidence refs, confidence, materiality reason, and conflict score explanation
**And** the explanation uses business language rather than scanner-only terminology.

**Given** conflict score is shown
**When** Manager reviews the score
**Then** LCSP explains that the score prioritizes review effort
**And** does not present it as legal risk, compliance status, or final classification.

**Given** a conflict references technical evidence
**When** Manager inspects the evidence basis
**Then** LCSP shows redacted evidence context and coverage limitations
**And** does not expose raw source, secrets, full prompts, or out-of-scope data.

### Story 5.3: Manager Conflict Resolution

As a Manager,
I want to resolve material conflicts with guided choices and evidence context,
So that LCSP can produce a coherent verified assessment profile.

**Acceptance Criteria:**

**Given** unresolved material conflicts exist
**When** Manager opens a conflict task
**Then** LCSP shows available resolution choices, source refs, confidence, explanation, and downstream impact
**And** Manager can choose, correct, or mark unknown according to allowed resolution rules.

**Given** Manager submits a resolution
**When** LCSP validates the decision
**Then** LCSP records selected value, rationale, actor, timestamp, policy decision, source refs, and conflict version
**And** unresolved required conflicts continue blocking VerifiedProfile creation.

**Given** evidence, profile, AIUsageFlow, or reconciliation version changed after Manager opened a conflict task
**When** Manager submits a resolution based on the stale version
**Then** LCSP rejects the submission or requires refresh
**And** no stale resolution is applied to the current reconciliation version.

**Given** a resolution attempts to overwrite scanner evidence or hide material uncertainty
**When** LCSP validates the decision
**Then** LCSP blocks or records it as Manager interpretation only
**And** immutable evidence remains unchanged.

### Story 5.4: Preserve Scanner Evidence During Resolution

As LCSP,
I want conflict resolution to preserve immutable scanner evidence,
So that Manager decisions cannot overwrite technical evidence history.

**Acceptance Criteria:**

**Given** TechnicalEvidenceReport or TechnicalProfile is referenced by a conflict
**When** Manager resolves the conflict
**Then** LCSP stores resolution as a separate reconciliation decision
**And** original scanner evidence, report hash, profile version, and finding refs remain immutable.

**Given** later scan rerun creates new evidence
**When** reconciliation runs again
**Then** LCSP creates a new reconciliation version or marks prior decisions for review as required
**And** does not mutate historical resolutions.

**Given** audit or export views show reconciliation history
**When** a user reviews the record
**Then** LCSP displays evidence version, resolution version, actor, timestamp, and rationale trail.

### Story 5.5: Create VerifiedProfile After Gates Pass

As LCSP,
I want to create VerifiedProfile only after required gates and conflict resolution pass,
So that legal matching and classification use a validated source profile.

**Acceptance Criteria:**

**Given** required WizardProfile, TechnicalProfile, AIUsageFlow, evidence gates, and reconciliation decisions are complete
**When** VerifiedProfile generation runs
**Then** LCSP creates a versioned VerifiedProfile with verified assessment facts, source refs, non-critical unresolved unknowns, confidence, gate status, and audit metadata.

**Given** required conflicts are unresolved, technical evidence is insufficient, or critical dimensions remain blocked
**When** VerifiedProfile generation is requested
**Then** LCSP denies generation with neutral blocker explanation
**And** legal matching and classification remain unavailable.

**Given** a critical dimension remains unknown, unclear, conflict-bearing, or insufficiently evidenced
**When** VerifiedProfile approval or downstream classification eligibility is evaluated
**Then** LCSP blocks approval or marks classification ineligible according to gate policy
**And** does not carry the critical unknown as an approved final fact.

**Given** VerifiedProfile exists
**When** downstream legal matching or classification reads assessment facts
**Then** LCSP uses VerifiedProfile as the canonical assessment input
**And** does not read unresolved WizardProfile, TechnicalProfile, or AIUsageFlow values directly as final facts.

### Story 5.6: Manager Review and Approval of VerifiedProfile

As a Manager,
I want to review and approve VerifiedProfile before downstream classification,
So that I remain accountable for final assessment facts.

**Acceptance Criteria:**

**Given** VerifiedProfile is generated
**When** Manager opens the review surface
**Then** LCSP shows verified facts, source refs, remaining unknowns, confidence, evidence versions, reconciliation decisions, and downstream readiness state
**And** the review avoids final legal classification wording.

**Given** Manager approves VerifiedProfile
**When** all RBAC and state gates pass
**Then** LCSP records approval actor, timestamp, policy version, VerifiedProfile version, and audit event
**And** downstream legal matching can proceed.

**Given** Manager rejects or requests revision
**When** the decision is saved
**Then** LCSP records the reason and returns the assessment to the appropriate reconciliation or evidence-readiness state
**And** classification remains blocked until a VerifiedProfile is approved.

**Handoff Contract:** Producer: reconciliation domain. Consumer: legal matching domain. Artifact: `VerifiedProfile` with version, assessment ID, organization ID, source profile refs, reconciliation decision refs, non-critical unknowns, approval status, RBAC scope, audit event, validation gate status, and failure behavior for stale or critical unknown facts.

## Epic 6: Legal Corpus Retrieval and LegalRuleMatch Evidence

Internal legal operations can ingest and approve immutable LegalCorpusVersion; LCSP creates LegalRuleMatch through ChromaDB structure-first vectorless retrieval with PRIMARY_MATCH, PARENT_CONTEXT, REFERENCED_CONTEXT, one-hop xref expansion, and citation allowlist validation.

### Story 6.1: Ingest Official Legal Source Snapshot

As an Internal Legal Operator,
I want to ingest official legal source snapshots,
So that LCSP can preserve immutable legal corpus evidence.

**Acceptance Criteria:**

**Given** an Internal Legal Operator provides an approved legal source URL, file, or source reference
**When** ingestion starts
**Then** LCSP captures an immutable source snapshot with document metadata, source URL, retrieval timestamp, source checksum, operator, and ingestion run ID
**And** the snapshot is not editable in place after capture.

**Given** source retrieval fails, checksum validation fails, or required metadata is missing
**When** ingestion validates the source
**Then** LCSP rejects the ingestion run
**And** records a failure reason without creating an approved LegalCorpusVersion.

**Given** an ingested source has effective date, expiry, amendment, or supersession metadata
**When** LCSP stores the snapshot
**Then** it preserves effective_from, effective_to, legal_status, checksum, and supersedes relationships for version resolution.

### Story 6.2: Parse Legal Structure and Stable Hierarchical IDs

As LCSP,
I want to parse document, article, clause, and point hierarchy into stable IDs,
So that legal retrieval preserves legal context.

**Acceptance Criteria:**

**Given** an immutable source snapshot exists
**When** legal structure parsing runs
**Then** LCSP extracts document title, article number/title, clause number, point code, hierarchy path, and text units
**And** creates stable hierarchical IDs such as `{document_id}::art-{article_no}`, `{document_id}::art-{article_no}::cl-{clause_no}`, and `{document_id}::art-{article_no}::cl-{clause_no}::pt-{point_code}`.

**Given** a clause or point is longer than preferred retrieval size
**When** LCSP prepares retrieval units
**Then** LCSP does not split between sentences or clauses merely for token size
**And** preserves clause-level base retrieval unit with parent document and article context.

**Given** a legal text references another article, clause, point, or document
**When** cross-reference extraction runs
**Then** LCSP records outgoing and incoming reference IDs
**And** preserves unresolved references as validation warnings or errors according to legal corpus rules.

### Story 6.3: Approve LegalCorpusVersion

As an Internal Legal Operator,
I want to approve a LegalCorpusVersion after validation,
So that assessments retrieve only approved effective legal corpus data.

**Acceptance Criteria:**

**Given** a parsed corpus candidate passes required validation
**When** the Internal Legal Operator approves it
**Then** LCSP creates an approved LegalCorpusVersion with corpus_version_id, checksum set, effective-date metadata, status, approver, approval timestamp, and audit event.

**Given** validation errors remain for structure, effective dates, required metadata, checksum, or source provenance
**When** approval is attempted
**Then** LCSP blocks approval
**And** records the blocker reasons.

**Given** a corpus version is expired, superseded, or not yet effective
**When** a new assessment requests legal retrieval
**Then** LCSP does not use that version as the active retrieval corpus unless explicitly configured for historical assessment context.

### Story 6.4: Build ChromaDB Structure-First Vectorless Legal Index

As LCSP,
I want to build a ChromaDB legal index without pgvector or mandatory dense embeddings,
So that retrieval uses structure, metadata, full-text matching, direct ID lookup, and xref graph expansion.

**Acceptance Criteria:**

**Given** an approved LegalCorpusVersion exists
**When** legal index build is requested
**Then** LCSP writes legal records to ChromaDB with stable IDs, document/chunk text, metadata filters, full-text searchable fields, direct lookup identifiers, and cross-reference metadata
**And** does not require PostgreSQL pgvector, dense embedding generation, or semantic nearest-neighbor retrieval for the MVP legal retrieval path.

**Given** index build succeeds
**When** LCSP records the outcome
**Then** it emits or stores `LEGAL_INDEX_BUILD_COMPLETED` with corpus version, index reference, checksum, count summary, and audit metadata.

**Given** index build fails or produces invalid counts/checksums
**When** LCSP records the outcome
**Then** it emits or stores `LEGAL_INDEX_BUILD_FAILED`
**And** the failed index is not used for LegalRuleMatch generation.

### Story 6.5: Retrieve Primary, Parent, and Referenced Context

As LCSP,
I want legal retrieval to assemble PRIMARY_MATCH, PARENT_CONTEXT, and REFERENCED_CONTEXT,
So that LegalRuleMatch has correct legal provenance.

**Acceptance Criteria:**

**Given** an approved VerifiedProfile requests legal matching
**When** legal retrieval runs
**Then** LCSP retrieves primary candidate chunks from the approved corpus using structure-first metadata, full-text matching, direct ID lookup, or equivalent vectorless retrieval path
**And** labels those chunks with `context_role=PRIMARY_MATCH`.

**Given** a primary chunk is a clause or point
**When** retrieval assembles context
**Then** LCSP includes document title, article number/title, parent clause context as applicable, and hierarchy metadata as `PARENT_CONTEXT`
**And** does not represent parent context as a separate primary hit.

**Given** a primary chunk references another legal unit
**When** one-hop xref expansion runs
**Then** LCSP retrieves referenced legal context as `REFERENCED_CONTEXT`
**And** records reference reason, referenced chunk ID, corpus version, and provenance separately from primary hits.

### Story 6.6: Enforce Retrieved and Context Citation Allowlist

As LCSP,
I want legal references accepted only when they point to primary, parent, or referenced context chunks,
So that out-of-allowlist citations are rejected.

**Acceptance Criteria:**

**Given** legal matching or LLM output proposes a legal_ref
**When** citation validation runs
**Then** LCSP accepts the legal_ref only if it points to a chunk in retrieved_chunks, parent_context_chunks, or referenced_context_chunks for the current retrieval run
**And** validates corpus_version_id, chunk ID, hierarchy metadata, and context role.

**Given** a legal_ref points outside the retrieved citation allowlist
**When** validation runs
**Then** LCSP rejects the citation
**And** blocks or degrades the LegalRuleMatch according to guardrail policy
**And** records rejection reason and audit metadata.

**Given** referenced context is cited
**When** the citation is shown or stored
**Then** LCSP preserves that it was `REFERENCED_CONTEXT`
**And** does not present it as the primary legal match unless separately retrieved as primary.

**Given** parent context is cited
**When** the citation is shown or stored
**Then** LCSP preserves that it was `PARENT_CONTEXT`
**And** does not present it as a separate primary hit unless separately retrieved as primary.

### Story 6.7: Create LegalMatchingResult and LegalRuleMatch Evidence

As LCSP,
I want to create LegalMatchingResult with linked LegalRuleMatch evidence from VerifiedProfile and retrieved legal context,
So that classification can use citation-backed legal evidence.

**Acceptance Criteria:**

**Given** VerifiedProfile is approved and legal retrieval returns validated context
**When** legal matching generation runs
**Then** LCSP creates LegalMatchingResult with legal_matching_result_id, version, `classificationEligible`, citation coverage, blocking reasons when applicable, retrieval audit ID, corpus_version_id, VerifiedProfile version, corpus/index version, and linked `LegalRuleMatch[]`
**And** each LegalRuleMatch includes matched rule, reasoning summary, legal_refs, primary chunk IDs, parent context IDs, referenced context IDs, retrieval run ID, confidence, and validation status.

**Given** required legal context is missing, expired, invalid, or citation validation fails
**When** legal matching generation runs
**Then** LCSP returns LegalMatchingResult with blocked or insufficient legal match status, `classificationEligible=false`, citation coverage, and blocking reasons
**And** downstream classification cannot present final risk without sufficient citation-backed legal evidence.

**Given** VerifiedProfile or LegalCorpusVersion changes after LegalMatchingResult creation
**When** classification eligibility is evaluated
**Then** LCSP marks the LegalMatchingResult stale or ineligible
**And** classification request must use a refreshed legal matching result.

**Given** Manager or auditor inspects LegalRuleMatch
**When** LCSP displays the legal evidence
**Then** it shows a citation drawer with sections for Primary legal basis, Parent context, and Referenced context
**And** each citation displays document title, article, clause, point, context role, allowlist pass/fail, corpus version, effective dates/status, source URL or reference, source checksum or integrity reference, and xref reason where applicable
**And** referenced and parent context are visually demoted from primary legal basis unless separately retrieved as primary.

**Handoff Contract:** Producer: legal matching domain. Consumer: classification domain. Artifact: `LegalMatchingResult` with legal_matching_result_id, version, linked `LegalRuleMatch[]`, classification eligibility, citation coverage, blocking reasons, retrieval audit ID, VerifiedProfile version, corpus version, RBAC scope, audit event, validation gate status, and failure behavior for invalid citations, stale VerifiedProfile, or stale corpus versions.

## Epic 7: Citation-Backed Classification

Manager receives a risk classification result or blocked/degraded state based on VerifiedProfile, LegalRuleMatch, citation coverage, real LLM provider guardrails, and hard-rule precedence. Classification must not be based on provider-only evidence or citations outside the retrieved allowlist.

### Story 7.1: Submit Classification Request From Approved VerifiedProfile

As a Manager,
I want to request classification only after VerifiedProfile and legal evidence are ready,
So that classification starts from validated assessment facts.

**Acceptance Criteria:**

**Given** Manager has RBAC permission and an approved VerifiedProfile exists
**When** Manager requests classification
**Then** LCSP validates assessment state, VerifiedProfile approval, LegalMatchingResult readiness, `classificationEligible=true`, citation coverage, blocking reasons, retrieval audit ID, and required evidence gates
**And** creates a classification request with assessment ID, VerifiedProfile version, LegalMatchingResult version, linked LegalRuleMatch refs, actor, timestamp, and correlation ID.

**Given** VerifiedProfile is missing, unapproved, stale, or blocked
**When** Manager requests classification
**Then** LCSP denies the request with neutral readiness explanation
**And** no final risk label is shown.

### Story 7.2: Apply Hard-Rule and LegalRuleMatch Precedence

As LCSP,
I want hard rules and LegalRuleMatch evidence to control classification precedence,
So that LLM output cannot override deterministic legal constraints.

**Acceptance Criteria:**

**Given** hard-rule conditions or authoritative LegalRuleMatch constraints apply
**When** classification runs
**Then** LCSP applies those rules before model-generated interpretation
**And** records the rule ID, LegalRuleMatch refs, precedence reason, and outcome.

**Given** model output conflicts with hard-rule or LegalRuleMatch precedence
**When** output validation runs
**Then** LCSP rejects or corrects the model output according to guardrail policy
**And** preserves the rejection reason in audit metadata.

### Story 7.3: Use Real LLM Provider With Schema and Budget Guardrails

As LCSP,
I want classification to use configured real LLM providers with schema, timeout, budget, and retry controls,
So that output is production-valid and bounded.

**Acceptance Criteria:**

**Given** classification requires model-assisted reasoning
**When** LCSP calls an LLM provider
**Then** LCSP uses a configured real provider, approved prompt/template version, schema-constrained output, timeout, retry policy, and budget controls
**And** records provider, model, prompt version, request ID, and cost or token metadata where available without storing sensitive prompt content beyond policy.

**Given** provider call fails, times out, exceeds budget, or returns schema-invalid output
**When** classification handles the result
**Then** LCSP retries only within configured policy
**And** otherwise returns blocked or degraded classification state with audit evidence.

### Story 7.4: Reject Provider-Only or Unsupported Classification

As LCSP,
I want to block classification when evidence is only provider/framework detection or when critical usage facts are unknown,
So that LCSP does not overclaim legal risk.

**Acceptance Criteria:**

**Given** evidence only shows provider, framework, SDK, package, endpoint, or model invocation indicators
**When** classification evaluates sufficiency
**Then** LCSP does not classify risk from provider-only evidence
**And** requires VerifiedProfile and LegalRuleMatch evidence before final classification.

**Given** critical AI usage facts remain unknown, unclear, unresolved, or conflict-bearing
**When** classification is requested
**Then** LCSP blocks or degrades classification according to policy
**And** explains the missing evidence or unresolved dimension without assigning unsupported final risk.

### Story 7.5: Validate Classification Citations Against Legal Allowlist

As LCSP,
I want all classification citations validated against retrieved legal context,
So that final classification cannot cite outside the allowlist.

**Acceptance Criteria:**

**Given** classification output contains legal citations or legal_refs
**When** citation validation runs
**Then** LCSP accepts only citations present in the current LegalMatchingResult primary, parent, or referenced context allowlist
**And** validates corpus version, chunk ID, locator, context role, and effective-date status.

**Given** classification output cites law outside the allowlist or fabricates a locator
**When** validation runs
**Then** LCSP rejects the citation and blocks or degrades the classification result
**And** records the validation failure.

### Story 7.6: Present Classification, Blocked, or Degraded State

As a Manager,
I want to see classification result or clear blocked/degraded state,
So that I understand whether LCSP produced a valid result and what evidence is missing.

**Acceptance Criteria:**

**Given** classification succeeds
**When** Manager views the result
**Then** LCSP shows classification outcome, confidence, cited legal evidence, VerifiedProfile version, LegalMatchingResult version, linked LegalRuleMatch refs, model/provider metadata where allowed, and generation timestamp
**And** the UI uses `FINAL_CLASSIFICATION` label only when final gates pass
**And** distinguishes final classification from readiness-only, blocked, degraded, and intermediate evidence states.

**Given** classification is blocked or degraded
**When** Manager views the assessment
**Then** LCSP shows `BLOCKED_NO_CLASSIFICATION` or `DEGRADED_NOT_FINAL`, blocker reason, missing evidence, failed gate, or degraded condition
**And** does not display unsupported HIGH/MEDIUM/LOW risk or compliance conclusion
**And** final report generation and final report download remain blocked while the state is not final.

**Given** classification result is generated
**When** LCSP stores it
**Then** the result is versioned and auditable
**And** later reruns create new classification versions without mutating prior results.

**Handoff Contract:** Producer: classification domain. Consumer: gap analysis and document domains. Artifact: classification result with version, VerifiedProfile ref, LegalMatchingResult ref, linked LegalRuleMatch refs, hard-rule refs, model metadata, citation validation status, RBAC scope, audit event, validation gate status, and failure behavior for blocked/degraded classification.

## Epic 8: Gap Analysis, Guarded Documents, and Audit Trail

Manager can review GapAnalysis, generate final reports or readiness-only exports under output guardrails, download artifacts, and inspect or export the redacted audit trail for the assessment.

### Story 8.1: Generate GapAnalysis From Classification and Evidence

As LCSP,
I want to generate GapAnalysis from classification, LegalRuleMatch, VerifiedProfile, and evidence gaps,
So that Manager can see actionable compliance gaps.

**Acceptance Criteria:**

**Given** classification and required evidence are available
**When** GapAnalysis generation runs
**Then** LCSP creates gap items linked to classification result, LegalRuleMatch refs, VerifiedProfile facts, evidence limitations, and recommended remediation area
**And** each gap has priority, rationale, source refs, status, and timestamp.

**Given** classification is blocked or degraded
**When** GapAnalysis generation runs
**Then** LCSP creates evidence-readiness or blocker gaps instead of final compliance gaps
**And** does not imply final legal classification or compliance failure.

### Story 8.2: Display Gap Analysis With Evidence and Priority

As a Manager,
I want to review gaps with evidence refs, priority, and recommended actions,
So that I can understand what to remediate.

**Acceptance Criteria:**

**Given** GapAnalysis exists
**When** Manager opens the gap view
**Then** LCSP shows each gap with title, priority, status, affected assessment area, evidence refs, legal refs where available, explanation, and recommended action
**And** distinguishes evidence gaps from final classification-backed compliance gaps.

**Given** a gap references legal or technical evidence
**When** Manager inspects the gap
**Then** LCSP shows redacted provenance, corpus version or evidence version, and limitation notes
**And** does not expose raw source, secrets, full prompts, or out-of-scope data.

### Story 8.3: Generate Guarded Final Report

As a Manager,
I want to generate a final report only when required evidence and classification gates pass,
So that the document does not overclaim compliance or legal certainty.

**Acceptance Criteria:**

**Given** VerifiedProfile, LegalRuleMatch, classification, citation validation, and GapAnalysis are ready
**When** Manager requests final report generation
**Then** LCSP generates a versioned final report with assessment summary, evidence summary, classification, legal citations, gaps, limitations, artifact metadata, and audit event
**And** report claims are constrained by approved evidence and citation allowlist.

**Given** required final-report gates fail
**When** Manager requests final report generation
**Then** LCSP blocks final report generation
**And** explains missing gates or required next actions without creating a final legal conclusion.

**Given** generated report text includes unsupported compliance certification, legal certainty, out-of-allowlist citation, or ungrounded risk label
**When** output guardrails evaluate it
**Then** LCSP blocks or removes the overclaim
**And** records the guardrail event.

### Story 8.4: Generate Evidence Readiness Report When Final Evidence Is Missing

As a Manager,
I want an Evidence Readiness Report when final classification is unavailable,
So that I can share preparation status without implying legal conclusion.

**Acceptance Criteria:**

**Given** final classification or legal evidence is unavailable but readiness data exists
**When** Manager requests Evidence Readiness Report from the document/artifact pipeline
**Then** LCSP generates a report clearly labeled `Evidence Readiness Report` and readiness-only in title, badge, metadata, preview, artifact history, and download state
**And** includes missing evidence, unresolved blockers, readiness checklist, preparation guidance, artifact version, and source assessment versions
**And** this report does not replace the Wizard Readiness Export from Story 2.4.

**Given** readiness-only report content attempts to include final risk, legal conclusion, compliance certification, or non-compliant wording
**When** output guardrails evaluate it
**Then** LCSP blocks generation or removes the overclaim
**And** records the guardrail event.

### Story 8.5: Download Versioned Artifacts

As a Manager,
I want to download generated reports and artifacts with version metadata,
So that assessment evidence remains traceable.

**Acceptance Criteria:**

**Given** a report or export artifact is generated
**When** Manager opens artifact history
**Then** LCSP shows artifact type, version, status, created by, created at, source assessment versions, checksum, and download availability.

**Given** Manager downloads an artifact
**When** LCSP serves the file
**Then** access is RBAC-checked
**And** download is audited with artifact ID, version, actor, timestamp, and correlation ID.

**Given** Manager permission, organization membership, artifact access, or assessment scope is revoked after artifact generation
**When** the actor attempts to download the artifact
**Then** LCSP denies download server-side, hides or marks the artifact unavailable, and audits the denial.

**Given** a newer artifact version exists
**When** Manager views historical artifacts
**Then** LCSP preserves older versions as immutable historical records
**And** clearly marks current versus superseded artifacts.

### Story 8.6: Record Immutable Assessment Audit Trail

As LCSP,
I want all material assessment actions recorded in an immutable, redacted audit trail,
So that assessment decisions are traceable.

**Acceptance Criteria:**

**Given** material actions occur across authentication, RBAC, assessment, wizard, repository, scan, evidence, AIUsageFlow, reconciliation, legal retrieval, classification, reports, artifacts, or exports
**When** LCSP processes the action
**Then** it records audit event with actor, action, resource, organization, assessment ID, result, timestamp, policy version where applicable, correlation ID, and redaction status.

**Given** an event includes sensitive data, tokens, secrets, raw source, full prompts, or out-of-scope details
**When** audit payload is written
**Then** LCSP redacts or omits sensitive fields
**And** stores only approved metadata and safe refs.

**Given** audit event write fails for a material action
**When** LCSP evaluates the operation
**Then** it follows the configured failure policy for blocking, retrying, or marking degraded state
**And** never silently drops required audit evidence.

### Story 8.7: View and Export Redacted Audit Trail

As a Manager or authorized auditor,
I want to view and export redacted audit events,
So that I can review assessment history without exposing secrets or out-of-scope data.

**Acceptance Criteria:**

**Given** an authorized Manager or auditor opens audit trail
**When** LCSP loads assessment audit events
**Then** it shows redacted event timeline with filters for actor, action, result, domain, artifact, date, and correlation ID
**And** access is RBAC-checked and audited.

**Given** a user requests audit export
**When** the export is authorized
**Then** LCSP creates a redacted audit export with assessment ID, export version, filter criteria, generated timestamp, checksum, and audit event
**And** excludes secrets, tokens, raw source, full prompts, and out-of-scope tenant data.

**Given** a user lacks audit permission or requests out-of-scope data
**When** LCSP handles the request
**Then** access is denied server-side with safe explanation
**And** denial is audited.
