---
status: ACTIVE_MODULE_TASK_CATALOG
artifact_type: implementation_task_catalog
source: docs/implementation/tasks/modules
---

# LCSP Module Task Catalog

This is the active implementation task catalog. The previous coarse-grained `module task catalog range` briefs were removed because module-scoped tasks are now the build authority.

## Authority Rules

- Use task files under `docs/implementation/tasks/modules/**` as the active implementation backlog.
- Do not route implementation work to deleted legacy `module task catalog range` briefs or task handbooks.
- Use generated Jira CSV files in `docs/developer/jira-lcsp-*.csv` only after regenerating them from this module catalog.
- A task with `status: DONE` is implementation evidence, not a next-work candidate.
- A task with `status: READY_FOR_DEV` is eligible once its dependencies are done or explicitly waived by the story owner.

## Status Summary

| Status | Count |
|---|---:|
| `DONE` | 7 |
| `READY_FOR_DEV` | 84 |

Recounted 2026-07-05 directly from `docs/implementation/tasks/modules/**` frontmatter (91 task files total) after the Phase 5.2M task-sync audit found this table stale (previously 80 `READY_FOR_DEV`).

## Module Summary

| Module | Runtime(s) | P0 | P1 | Done | Ready | Task files |
|---|---|---:|---:|---:|---:|---:|
| `ai-usage-flow` | nestjs-api | 1 | 0 | 0 | 1 | 1 |
| `assessment` | nestjs-api | 3 | 0 | 0 | 3 | 3 |
| `audit` | nestjs-api | 0 | 2 | 0 | 2 | 2 |
| `auth-workspace` | nestjs-api | 14 | 0 | 7 | 7 | 14 |
| `classification` | nestjs-api | 2 | 0 | 0 | 2 | 2 |
| `document` | nestjs-api | 0 | 3 | 0 | 3 | 3 |
| `evidence` | nestjs-api | 2 | 0 | 0 | 2 | 2 |
| `github-integration` | nestjs-api | 4 | 0 | 0 | 4 | 4 |
| `legal-rule-catalog` | nestjs-api | 0 | 1 | 0 | 1 | 1 |
| `platform/audit-writer` | nestjs-api | 2 | 0 | 0 | 2 | 2 |
| `platform/config` | nestjs-api | 1 | 0 | 0 | 1 | 1 |
| `platform/outbox` | nestjs-api | 2 | 1 | 0 | 3 | 3 |
| `platform/pbac` | nestjs-api<br>nestjs-api + python-workers | 3 | 1 | 0 | 4 | 4 |
| `python-workers/classification` | deepagents | 1 | 0 | 0 | 1 | 1 |
| `python-workers/intelligence` | deepagents | 4 | 0 | 0 | 4 | 4 |
| `python-workers/legal` | deepagents | 1 | 0 | 0 | 1 | 1 |
| `python-workers/llm` | deepagents | 1 | 0 | 0 | 1 | 1 |
| `python-workers/platform` | deepagents | 3 | 1 | 0 | 4 | 4 |
| `python-workers/reporting` | deepagents | 0 | 3 | 0 | 3 | 3 |
| `python-workers/scanner` | deepagents | 14 | 1 | 0 | 15 | 15 |
| `qa` | nestjs-api<br>deepagents<br>all | 2 | 1 | 0 | 3 | 3 |
| `reconciliation` | nestjs-api | 4 | 0 | 0 | 4 | 4 |
| `scan` | nestjs-api | 2 | 1 | 0 | 3 | 3 |
| `web` | nextjs | 4 | 2 | 0 | 6 | 6 |
| `wizard` | nestjs-api | 3 | 1 | 0 | 4 | 4 |

`legal-rule-catalog` is new (Phase 5.2M, `MW-lrc-001`). `python-workers/scanner` corrected from 12 to 15 task files (already existed at 15; the prior count predates this audit).

## Story Coverage

| Story | Title | P0 Ready | P1 Ready | Done | Tasks |
|---|---|---:|---:|---:|---:|
| `1.1` | Story 1.1: Approved Account Entry and Workspace Access | 5 | 1 | 2 | 8 |
| `1.2` | Story 1.2: MFA, Session, Recovery, and Profile Safety | 1 | 0 | 4 | 5 |
| `1.3` | Story 1.3: OAuth/OIDC Login Without Repository Authorization | 2 | 0 | 0 | 2 |
| `1.4` | Story 1.4: Organization Membership and Manager Policy Scope | 1 | 0 | 1 | 2 |
| `1.5` | Story 1.5: Optional Developer Invitation and Scoped Task Acceptance | 3 | 0 | 0 | 3 |
| `1.6` | Story 1.6: Manager-Only Action Enforcement | 4 | 0 | 0 | 4 |
| `1.7` | Story 1.7: PBAC Policy Runtime and Deny-on-Failure Contract | 0 | 1 | 0 | 1 |
| `1.8` | Story 1.8: Foundational Audit, Outbox, and Event Contract | 3 | 0 | 0 | 3 |
| `2.1` | Story 2.1: Create Manager-Owned Assessment | 4 | 2 | 0 | 6 |
| `2.2` | Story 2.2: Complete WizardProfile in Business Language | 3 | 0 | 0 | 3 |
| `2.3` | Story 2.3: Wizard-Only Readiness Without Risk Level | 2 | 0 | 0 | 2 |
| `2.4` | Story 2.4: Wizard Readiness Export | 0 | 1 | 0 | 1 |
| `3.1` | Story 3.1: Connect Read-Only GitHub Repository | 2 | 0 | 0 | 2 |
| `3.2` | Story 3.2: Pin Commit and Create RepositorySnapshot | 1 | 0 | 0 | 1 |
| `3.3` | Story 3.3: Trusted Scan Trigger and Scan Job Orchestration | 3 | 1 | 0 | 4 |
| `3.4` | Story 3.4: Static Scanner Workspace and Sandbox | 1 | 0 | 0 | 1 |
| `3.5` | Story 3.5: Static Scanner Toolchain Execution | 15 | 1 | 0 | 16 |
| `3.6` | Story 3.6: Scan Failure Severity and Evidence Acceptance Policy | 2 | 0 | 0 | 2 |
| `4.1` | Story 4.1: Build AIUsageFlow From Wizard and Technical Evidence | 1 | 0 | 0 | 1 |
| `4.2` | Story 4.2: Preserve TechnicalProfile and AIUsageFlow Separation | 2 | 0 | 0 | 2 |
| `5.1` | Story 5.1: Detect Material Profile Conflicts | 2 | 0 | 0 | 2 |
| `5.2` | Story 5.2: Explain Conflict Score and Evidence Basis | 1 | 0 | 0 | 1 |
| `5.3` | Story 5.3: Manager Conflict Resolution | 2 | 0 | 0 | 2 |
| `5.4` | Story 5.4: Preserve Scanner Evidence During Resolution | 2 | 0 | 0 | 2 |
| `6.1` | Story 6.1: Ingest Official Legal Source Snapshot | 1 | 0 | 0 | 1 |
| `6.2` | Story 6.2: Parse Legal Structure and Stable Hierarchical IDs | 1 | 0 | 0 | 1 |
| `6.3` | Story 6.3: Legal Rule Catalog Authoring and Approval Governance | 0 | 1 | 0 | 1 |
| `6.7` | Story 6.7: Create LegalMatchingResult and LegalRuleMatch Evidence | 1 | 0 | 0 | 1 |
| `7.3` | Story 7.3: Use Real LLM Provider With Schema and Budget Guardrails | 0 | 3 | 0 | 3 |
| `7.5` | Story 7.5: Validate Classification Citations Against Legal Allowlist | 1 | 0 | 0 | 1 |
| `8.1` | Story 8.1: Generate GapAnalysis From Classification and Evidence | 0 | 2 | 0 | 2 |
| `8.3` | Story 8.3: Generate Guarded Final Report | 0 | 2 | 0 | 2 |
| `8.6` | Story 8.6: Record Immutable Assessment Audit Trail | 0 | 1 | 0 | 1 |
| `8.7` | Story 8.7: View and Export Redacted Audit Trail | 0 | 2 | 0 | 2 |

Titles for `6.1`–`8.7` corrected against `docs/developer/jira-lcsp-story-task-mapping.csv` (the prior table listed placeholder titles for `7.1`/`7.2`/`8.2` that do not correspond to any current task file's `epic_story` value). `6.3` is new (Phase 5.2M, `MW-lrc-001`).
