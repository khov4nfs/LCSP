# LCSP Use Cases

## Purpose

Canonical active use-case catalog for the A-to-Z runnable MVP. Detailed user interaction sequences live in `user-task-flows.md`.

## Governance

- Canonical active IDs are `UC-001..UC-017`; legacy `UC-018` structured attestation is `SUPERSEDED_FOR_ACTIVE_MVP`.
- Legacy `UC-MXX-XX` values may remain only in `requirements-baseline.md` and the explicitly labeled source-alias columns of `business-rules.md`; they are not active traceability IDs.
- Canonical FRs are `FR-001..FR-056`; `FR-050` is `AUTOMATIC_TRUSTED_SCAN_INITIATION`, `FR-051` is `REMOVED_FROM_PRODUCT`, and `FR-052` is `DEFERRED_POST_MVP`.
- Manager completes the golden path without Developer participation.
- Structured attestation under historical `FR-045/FR-046` is removed from active MVP.
- Delegated free-form clarification under `FR-052` is Deferred.
- PBAC is the authorization source of truth. Role labels are not final authorization authority.
- Internal legal corpus operations are API/CLI-only for MVP, not Manager/Developer product UX.

## Inventory

| UC | Name | Primary Actor | FRs | ACs |
|---|---|---|---|---|
| UC-001 | Authenticate and Manage Account | Manager / Developer | FR-001..FR-006 | AC-021, AC-023 |
| UC-002 | Manage Organization and PBAC Policy Scope | Manager | FR-007..FR-012, FR-047 | AC-024..AC-026 |
| UC-003 | Create Assessment | Manager | FR-013 | AC-001 |
| UC-004 | Complete WizardProfile and Readiness | Manager | FR-014, FR-015, FR-040 | AC-002, AC-003 |
| UC-005 | Connect Repository | Manager; optional delegated Developer | FR-006, FR-016 | AC-004, AC-023 |
| UC-006 | Create Repository Snapshot | Manager / System | FR-017 | AC-004, AC-020 |
| UC-007 | Execute Repository Scan | Manager / System | FR-018..FR-020, FR-048 | AC-004, AC-005, AC-028..AC-032 |
| UC-008 | Generate TechnicalProfile | System | FR-021..FR-023 | AC-006, AC-007, AC-032 |
| UC-009 | Generate AIUsageFlow | System | FR-023..FR-025 | AC-008, AC-009, AC-031, AC-032 |
| UC-010 | Resolve Conflict | Manager | FR-026..FR-029 | AC-010..AC-012, AC-033 |
| UC-011 | Preserve AIUsageFlow Evidence Context | System | FR-030, FR-031 | AC-014, AC-015 |
| UC-012 | Operate Legal Corpus and Compile EngineeringRules | Internal Legal Operator / System | FR-032..FR-034, FR-053, FR-054, FR-056 | AC-016, AC-017, AC-034..AC-036 |
| UC-013 | Run Risk Classification | Manager / System | FR-035..FR-037, FR-055 | AC-018, AC-034, AC-037, AC-038 |
| UC-014 | Generate Gap Analysis and Documents | Manager / System | FR-038..FR-041 | AC-003, AC-018, AC-019, AC-041 |
| UC-015 | Review and Export Audit Trail | Manager / System | FR-042..FR-045 | AC-020, AC-039, AC-040 |
| UC-016 | Automatic Trusted Scan Initiation and Re-run Evidence | Manager / System | FR-049, FR-050 | AC-004, AC-020, AC-028, AC-039, AC-050A..AC-050F |
| UC-017 | Enforce Security and Privacy Controls | System | FR-019, FR-042, FR-048 | AC-022, AC-023, AC-030, AC-041 |

## UC-001 Authenticate and Manage Account

Goal: establish a safe organization-scoped session through approved password/MFA or OAuth/OIDC paths. Invalid identity, callback, MFA, session, or rate-limit state is denied safely and audited. OAuth identity does not grant repository access.

## UC-002 Manage Organization and Roles

Goal: maintain tenant membership, PBAC policy scope, Manager accountability, and optional scoped Developer collaboration. Cross-tenant actions, revoked policy scope, and Developer attempts at Manager-only actions are denied by server-side PBAC.

## UC-003 Create Assessment

Goal: create a Manager-owned Assessment in the organization and record the action. Missing organization or Manager authority blocks creation.

## UC-004 Complete WizardProfile and Readiness

Goal: capture purpose, sector, data, affected people, decision role, oversight, and external LLM usage in business language. Wizard-only output shows readiness gaps and never a risk level.

## UC-005 Connect Repository

Goal: connect a selected read-only GitHub repository through GitHub App. The system validates installation/repository scope separately from LCSP login.

## UC-006 Create Repository Snapshot

Goal: pin repository evidence to an immutable branch/commit snapshot. Inaccessible commits or invalid scope block snapshot creation.

## UC-007 Execute Repository Scan

Goal: convert the snapshot into static technical evidence through the Python Scanner Worker. The worker runs the approved scanner toolchain, including Syft, Knip, deptry, Python `ast`/`libcst`, bounded `ts-morph`, tree-sitter/custom parser, and Semgrep custom rules, persists metadata-only evidence, verifies cleanup, and emits completed or failed event.

## UC-008 Generate TechnicalProfile

Goal: aggregate an accepted TechnicalEvidenceReport into evidence-backed technical dimensions or explicit unknowns. Invalid or insufficient reports block profile creation.

## UC-009 Generate AIUsageFlow

Goal: combine WizardProfile, TechnicalProfile, findings, and evidence refs into claim-level usage facts with confidence and uncertainty. Provider-only evidence cannot confirm active use.

## UC-010 Resolve Conflict

Goal: let Manager resolve material mismatch while preserving scanner evidence. Structured attestation is not active MVP input. Free-form delegated clarification under `FR-052` is not active.

## UC-011 Preserve AIUsageFlow Evidence Context

Goal: preserve evidence-backed AIUsageFlow context for classification without a customer-facing VerifiedProfile approval gate. Open material conflict blocks final classification until resolved.

## UC-012 Operate Legal Corpus and Compile EngineeringRules

Goal: prepare an approved immutable legal corpus and compile citation-backed LegalRules into validated EngineeringRules. Source validation, ingestion, review, approval, and index build are Internal Legal Operator API/CLI operations. Manager/Developer UX only sees assessment-relevant corpus version and citations.

## UC-013 Run Risk Classification

Goal: create a cited risk result or explicit blocked state from direct EngineeringRule investigation. The acceptance run uses a real configured provider; missing citation, missing evidence refs, provider failure, invalid output, or unknown critical usage fails closed.

## UC-014 Generate Gap Analysis and Documents

Goal: derive compliance gaps and create a guarded final document. Readiness-only export may exist earlier without risk level. Missing classification, gap, citation, or conflict prerequisite blocks final output.

## UC-015 Review and Export Audit Trail

Goal: let Manager inspect and export redacted actor/action/object/time/version/correlation records across the assessment. Sensitive runtime content is excluded.

## UC-016 Re-run Assessment Evidence

Goal: create or resume a scan/evidence chain from trusted integration context without mutating history. Local/CI scanner report upload is superseded by `FR-050` automatic trusted scan initiation. Manual evidence JSON upload is removed from product scope.

## UC-017 Enforce Security and Privacy Controls

Goal: enforce source non-execution, restricted workspace, cleanup, redaction, no raw source to LLM, metadata-only persistence, and auditable fail-closed behavior.

## UX Boundary

`bmad-ux` designs Manager and optional Developer experiences for UC-001..UC-017, excluding the internal operations portion of UC-012. It must cover loading, empty, insufficient, permission-denied, blocked, failed, retry/rerun, degraded, automatic trigger mapping states, and audit-reference states. It must not create active screens for manual scanner report upload, `FR-051`, `FR-052`, structured attestation, or customer-facing corpus administration.

```text
CANONICAL_USE_CASES_NORMALIZED
CANONICAL_UC_IDS_ONLY_IN_ACTIVE_TRACEABILITY
LEGACY_UC_ALIASES_CLASSIFIED
UC_018_STRUCTURED_ATTESTATION_SUPERSEDED_FOR_ACTIVE_MVP
FR_050_AUTOMATIC_TRUSTED_SCAN_INITIATION
```
