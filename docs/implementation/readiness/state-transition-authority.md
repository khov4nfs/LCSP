---
status: ACTIVE_PLANNING_AUTHORITY
artifact_type: state_transition_authority
owner: LCSP Engineering
source_specs:
  - docs/specs/domain-state-machines.md
  - docs/specs/event-catalog.md
  - docs/implementation/decisions/pbac-runtime-decision.md
  - docs/implementation/decisions/trusted-scan-trigger-retry-dlq-replay-decision.md
  - docs/implementation/decisions/scanner-severity-tool-provenance-decision.md
---

# State Transition Authority

## Purpose

This artifact expands the domain state machines into implementation-readiness rows with allowed transition, guard, audit event, UI label class, and downstream eligibility.

Physical enum names remain owned by persistence implementation. This document is the planning authority for readiness review and implementation task handoff.

## UI Label Classes

| Class                       | Meaning                                                  |
| --------------------------- | -------------------------------------------------------- |
| `READINESS_ONLY`            | no final classification or final report                  |
| `IN_PROGRESS`               | work accepted/running; user can inspect status           |
| `BLOCKED_NO_CLASSIFICATION` | downstream legal/classification/final report unavailable |
| `DEGRADED_NOT_FINAL`        | diagnostic/readiness output only                         |
| `FINAL_CLASSIFICATION`      | classification passed all gates for that version         |
| `GENERATED_ARTIFACT`        | output artifact generated and versioned                  |
| `SUPERSEDED_VERSION`        | historical immutable version                             |

## Assessment and Wizard

| Current                | Trigger                    | Guard                          | Next                         | Audit event                    | UI class             | Downstream eligibility             |
| ---------------------- | -------------------------- | ------------------------------ | ---------------------------- | ------------------------------ | -------------------- | ---------------------------------- |
| none                   | create assessment          | PBAC allow `CREATE_ASSESSMENT` | `CREATED`                    | `assessment.created`           | `READINESS_ONLY`     | Wizard allowed                     |
| `CREATED`              | save draft                 | Manager owns assessment        | `WIZARD_IN_PROGRESS`         | `wizard.draft_saved`           | `READINESS_ONLY`     | submit when valid                  |
| `WIZARD_IN_PROGRESS`   | submit WizardProfile       | required fields valid          | `WIZARD_PROFILE_READY`       | `wizard.submitted`             | `READINESS_ONLY`     | repository connection allowed      |
| `WIZARD_PROFILE_READY` | readiness export requested | no accepted evidence           | `READINESS_EXPORT_GENERATED` | `document.readiness_requested` | `GENERATED_ARTIFACT` | final classification still blocked |

## Repository, Trigger, and Scan

| Current                  | Trigger                            | Guard                                              | Next                     | Audit event                        | UI class                    | Downstream eligibility      |
| ------------------------ | ---------------------------------- | -------------------------------------------------- | ------------------------ | ---------------------------------- | --------------------------- | --------------------------- |
| `WIZARD_PROFILE_READY`   | connect repository                 | GitHub App read-only scope + PBAC allow            | `REPOSITORY_CONNECTED`   | `repository.connected`             | `IN_PROGRESS`               | snapshot allowed            |
| `REPOSITORY_CONNECTED`   | trusted trigger received           | source verified                                    | `TRUSTED_SCAN_TRIGGERED` | `scan_trigger.received`            | `IN_PROGRESS`               | mapping validation          |
| `TRUSTED_SCAN_TRIGGERED` | mapping missing                    | resolvable missing context                         | `PENDING_MAPPING`        | `scan_trigger.mapping_pending`     | `BLOCKED_NO_CLASSIFICATION` | no scan                     |
| `TRUSTED_SCAN_TRIGGERED` | mapping ambiguous                  | unsafe/ambiguous context                           | `BLOCKED_MAPPING`        | `scan_trigger.mapping_blocked`     | `BLOCKED_NO_CLASSIFICATION` | no scan                     |
| `TRUSTED_SCAN_TRIGGERED` | out-of-order context               | can safely wait                                    | `WAITING_FOR_CONTEXT`    | `scan_trigger.waiting_for_context` | `BLOCKED_NO_CLASSIFICATION` | no scan                     |
| `TRUSTED_SCAN_TRIGGERED` | mapping resolved                   | unique assessment/repo/ref/commit                  | `SNAPSHOT_CREATED`       | `repository_snapshot.created`      | `IN_PROGRESS`               | scan request allowed        |
| `SNAPSHOT_CREATED`       | request scan                       | idempotency key valid                              | `SCAN_REQUESTED`         | `scan.requested`                   | `IN_PROGRESS`               | scanner worker allowed      |
| `SCAN_REQUESTED`         | worker lock acquired               | lease acquired                                     | `SCAN_RUNNING`           | `scan.started`                     | `IN_PROGRESS`               | evidence pending            |
| `SCAN_RUNNING`           | accepted with cleanup verified     | scanner severity `ACCEPTED` or accepted limitation | `SCAN_COMPLETED`         | `scan.completed`                   | `IN_PROGRESS`               | evidence gates allowed      |
| `SCAN_RUNNING`           | privacy/cleanup/provenance failure | scanner severity blocks                            | `SCAN_FAILED`            | `scan.failed`                      | `BLOCKED_NO_CLASSIFICATION` | no TechnicalProfile         |
| terminal scan            | rerun requested                    | PBAC allow + new generation                        | `SCAN_REQUESTED`         | `scan.rerun_requested`             | `IN_PROGRESS`               | creates new immutable chain |

## Evidence, Profile, and Usage Flow

| Current                    | Trigger               | Guard                                           | Next                              | Audit event                   | UI class                    | Downstream eligibility    |
| -------------------------- | --------------------- | ----------------------------------------------- | --------------------------------- | ----------------------------- | --------------------------- | ------------------------- |
| `SCAN_COMPLETED`           | evidence gates pass   | schema/privacy/provenance/quality valid         | `TECHNICAL_EVIDENCE_READY`        | `evidence.accepted`           | `IN_PROGRESS`               | TechnicalProfile allowed  |
| `SCAN_COMPLETED`           | evidence insufficient | quality/actionability insufficient              | `TECHNICAL_EVIDENCE_INSUFFICIENT` | `evidence.insufficient`       | `BLOCKED_NO_CLASSIFICATION` | no TechnicalProfile ready |
| `SCAN_COMPLETED`           | evidence rejected     | schema/privacy/provenance invalid               | `TECHNICAL_EVIDENCE_REJECTED`     | `evidence.rejected`           | `BLOCKED_NO_CLASSIFICATION` | no TechnicalProfile       |
| `TECHNICAL_EVIDENCE_READY` | profile completed     | profile persisted                               | `TECHNICAL_PROFILE_READY`         | `technical_profile.completed` | `IN_PROGRESS`               | AIUsageFlow allowed       |
| `TECHNICAL_PROFILE_READY`  | AIUsageFlow completed | material claims have source refs or uncertainty | `AI_USAGE_FLOW_READY`             | `ai_usage_flow.completed`     | `IN_PROGRESS`               | reconciliation allowed    |
| `TECHNICAL_PROFILE_READY`  | critical unknown      | required material usage unclear                 | `AI_USAGE_FLOW_UNCLEAR`           | `ai_usage_flow.unclear`       | `BLOCKED_NO_CLASSIFICATION` | no VerifiedProfile        |

## Reconciliation and VerifiedProfile

| Current                   | Trigger                                  | Guard                                    | Next                        | Audit event                      | UI class                    | Downstream eligibility          |
| ------------------------- | ---------------------------------------- | ---------------------------------------- | --------------------------- | -------------------------------- | --------------------------- | ------------------------------- |
| `AI_USAGE_FLOW_READY`     | reconciliation detects material conflict | conflict score/materiality threshold met | `RECONCILIATION_REQUIRED`   | `reconciliation.conflict_opened` | `BLOCKED_NO_CLASSIFICATION` | Manager resolution required     |
| `AI_USAGE_FLOW_READY`     | no material conflict                     | critical facts known                     | `VERIFIED_PROFILE_READY`    | `verified_profile.created`       | `IN_PROGRESS`               | Manager approval/legal matching |
| `RECONCILIATION_REQUIRED` | Manager resolves                         | PBAC allow + rationale + current version | `VERIFIED_PROFILE_READY`    | `conflict.resolved`              | `IN_PROGRESS`               | legal matching allowed          |
| `VERIFIED_PROFILE_READY`  | Manager approves                         | no critical unknown/unresolved conflict  | `VERIFIED_PROFILE_APPROVED` | `verified_profile.approved`      | `IN_PROGRESS`               | legal matching command allowed  |
| `VERIFIED_PROFILE_READY`  | upstream evidence rerun                  | new evidence/profile version             | `VERIFIED_PROFILE_STALE`    | `verified_profile.stale`         | `SUPERSEDED_VERSION`        | no new classification           |

## Legal Matching and Classification

| Current                     | Trigger                  | Guard                                                 | Next                       | Audit event                | UI class                    | Downstream eligibility         |
| --------------------------- | ------------------------ | ----------------------------------------------------- | -------------------------- | -------------------------- | --------------------------- | ------------------------------ |
| `VERIFIED_PROFILE_APPROVED` | legal matching requested | approved corpus index ready                           | `LEGAL_MATCHING_REQUESTED` | `legal_matching.requested` | `IN_PROGRESS`               | legal worker                   |
| `LEGAL_MATCHING_REQUESTED`  | match completed          | citation allowlist valid                              | `LEGAL_MATCHING_READY`     | `legal_matching.completed` | `IN_PROGRESS`               | classification allowed         |
| `LEGAL_MATCHING_REQUESTED`  | missing corpus/citation  | guard failed                                          | `LEGAL_MATCHING_BLOCKED`   | `legal_matching.blocked`   | `BLOCKED_NO_CLASSIFICATION` | no final classification        |
| `LEGAL_MATCHING_READY`      | classification requested | VerifiedProfile + LegalMatchingResult current         | `CLASSIFICATION_REQUESTED` | `classification.requested` | `IN_PROGRESS`               | classification worker          |
| `CLASSIFICATION_REQUESTED`  | classification completed | hard rules/citations/model output valid               | `CLASSIFICATION_READY`     | `classification.completed` | `FINAL_CLASSIFICATION`      | gap analysis allowed           |
| `CLASSIFICATION_REQUESTED`  | classification blocked   | unknown critical usage/missing citation/provider-only | `CLASSIFICATION_BLOCKED`   | `classification.blocked`   | `BLOCKED_NO_CLASSIFICATION` | no final report                |
| `CLASSIFICATION_REQUESTED`  | output degraded          | diagnostic only, not final                            | `CLASSIFICATION_DEGRADED`  | `classification.degraded`  | `DEGRADED_NOT_FINAL`        | readiness/evidence report only |

## Gap Analysis, Documents, and Audit Export

| Current                  | Trigger                         | Guard                              | Next                         | Audit event                    | UI class                    | Downstream eligibility   |
| ------------------------ | ------------------------------- | ---------------------------------- | ---------------------------- | ------------------------------ | --------------------------- | ------------------------ |
| `CLASSIFICATION_READY`   | gap requested                   | classification current             | `GAP_ANALYSIS_REQUESTED`     | `gap_analysis.requested`       | `IN_PROGRESS`               | gap worker               |
| `GAP_ANALYSIS_REQUESTED` | gap completed                   | legal/classification basis usable  | `GAP_ANALYSIS_READY`         | `gap_analysis.completed`       | `IN_PROGRESS`               | final report allowed     |
| `GAP_ANALYSIS_REQUESTED` | gap blocked                     | upstream basis unusable            | `GAP_ANALYSIS_BLOCKED`       | `gap_analysis.blocked`         | `BLOCKED_NO_CLASSIFICATION` | no final report          |
| `GAP_ANALYSIS_READY`     | final report requested          | output guard/citations pass        | `DOCUMENT_GENERATED`         | `document.generated`           | `GENERATED_ARTIFACT`        | download allowed by PBAC |
| any readiness state      | readiness-only report requested | no final risk wording              | `READINESS_REPORT_GENERATED` | `document.readiness_generated` | `GENERATED_ARTIFACT`        | readiness artifact only  |
| any document request     | output guard fails              | overclaim/invalid citation         | `DOCUMENT_BLOCKED`           | `document.blocked`             | `BLOCKED_NO_CLASSIFICATION` | no final download        |
| any assessment           | audit export requested          | PBAC allow + redaction policy pass | `AUDIT_EXPORT_GENERATED`     | `audit_export.generated`       | `GENERATED_ARTIFACT`        | download allowed by PBAC |

## Conformance Rules

- Every transition row requires PBAC evaluation when actor or service identity is involved.
- Every material transition must include `correlationId`.
- Every terminal or superseded artifact remains immutable.
- Readiness-only artifacts must not display HIGH/MEDIUM/LOW or legal conclusion.
- Final report requires `CLASSIFICATION_READY`, `GAP_ANALYSIS_READY`, valid citations, and no unresolved material conflict.

```text
STATE_TRANSITION_AUTHORITY_CREATED
AUDIT_EVENT_UI_CLASS_DOWNSTREAM_ELIGIBILITY_MAPPED
IMPLEMENTATION_READINESS_STATE_DETAIL_RESOLVED
```
