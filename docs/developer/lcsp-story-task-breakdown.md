# LCSP Story-Task Breakdown

Regenerated backlog model for the next Jira project.

## Operating Model

- `Epic` = business module.
- `Story` = acceptance and traceability anchor linked to an implementation artifact.
- `Task` = smallest shippable feature slice under one story, assigned directly to a dev owner.
- `Sub-task` = removed from this operating model.

## Summary

| Epic | Feature Tasks | Story Refs | Points | Primary Owners |
|---|---:|---|---:|---|
| Epic 1 - Authentication and Access Control | 8 | `1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8` | 24 | `L`, `A`, `C` |
| Epic 2 - Assessment and Interview | 4 | `2.1, 2.2, 2.3, 2.4` | 12 | `L`, `C`, `A` |
| Epic 3 - Repository Scan and Technical Evidence | 6 | `3.1, 3.2, 3.3, 3.4, 3.5, 3.6` | 18 | `L`, `B` |
| Epic 4 - AI Usage Analysis | 2 | `4.1, 4.2` | 6 | `C` |
| Epic 5 - Reconciliation and Verified Profile | 4 | `5.1, 5.2, 5.3, 5.4` | 12 | `C`, `A` |
| Epic 6 - Legal Corpus and Matching | 4 | `6.1, 6.2, 6.3, 6.7` | 12 | `D` |
| Epic 7 - Classification | 2 | `7.3, 7.5` | 6 | `L`, `A` |
| Epic 8 - Reporting and Audit | 4 | `8.1, 8.3, 8.6, 8.7` | 12 | `D`, `L` |

## Owner Totals

| Owner | Task Points |
|---|---:|
| `` | 3 |
| `A` | 15 |
| `B` | 12 |
| `C` | 27 |
| `D` | 18 |
| `L` | 27 |

## Epic 1 - Authentication and Access Control

Stories: `1.1`, `1.2`, `1.3`, `1.4`, `1.5`, `1.6`, `1.7`, `1.8`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E1-S11-F1 Story 1.1: Approved Account Entry and Workspace Access` | 3 | `L` | `1.1` | `none` | `` |
| `E1-S12-F1 Story 1.2: MFA, Session, Recovery, and Profile Safety` | 3 | `A` | `1.2` | `none` | `` |
| `E1-S13-F1 Story 1.3: OAuth/OIDC Login Without Repository Authorization` | 3 | `L` | `1.3` | `none` | `` |
| `E1-S14-F1 Story 1.4: Organization Membership and Manager Policy Scope` | 3 | `C` | `1.4` | `none` | `` |
| `E1-S15-F1 Story 1.5: Optional Developer Invitation and Scoped Task Acceptance` | 3 | `-` | `1.5` | `none` | `` |
| `E1-S16-F1 Story 1.6: Manager-Only Action Enforcement` | 3 | `C` | `1.6` | `none` | `` |
| `E1-S17-F1 Story 1.7: RBAC Policy Runtime and Deny-on-Failure Contract` | 3 | `C` | `1.7` | `none` | `` |
| `E1-S18-F1 Story 1.8: Foundational Audit, Outbox, and Event Contract` | 3 | `L` | `1.8` | `none` | `` |

## Epic 2 - Assessment and Interview

Stories: `2.1`, `2.2`, `2.3`, `2.4`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E2-S21-F1 Story 2.1: Create Manager-Owned Assessment` | 3 | `L` | `2.1` | `none` | `` |
| `E2-S22-F1 Story 2.2: Complete WizardProfile in Business Language` | 3 | `C` | `2.2` | `none` | `` |
| `E2-S23-F1 Story 2.3: Wizard-Only Readiness Without Risk Level` | 3 | `C` | `2.3` | `none` | `` |
| `E2-S24-F1 Story 2.4: Wizard Readiness Export` | 3 | `A` | `2.4` | `none` | `` |

## Epic 3 - Repository Scan and Technical Evidence

Stories: `3.1`, `3.2`, `3.3`, `3.4`, `3.5`, `3.6`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E3-S31-F1 Story 3.1: Connect Read-Only GitHub Repository` | 3 | `L` | `3.1` | `none` | `` |
| `E3-S32-F1 Story 3.2: Pin Commit and Create RepositorySnapshot` | 3 | `L` | `3.2` | `none` | `` |
| `E3-S33-F1 Story 3.3: Trusted Scan Trigger and Scan Job Orchestration` | 3 | `B` | `3.3` | `none` | `` |
| `E3-S34-F1 Story 3.4: Managed Repository Workspace and Sandbox` | 3 | `B` | `3.4` | `none` | `` |
| `E3-S35-F1 Story 3.5: Repository Deep Agent Evidence Analysis` | 3 | `B` | `3.5` | `none` | `` |
| `E3-S36-F1 Story 3.6: Scan Failure Severity and Evidence Acceptance Policy` | 3 | `B` | `3.6` | `none` | `` |

## Epic 4 - AI Usage Analysis

Stories: `4.1`, `4.2`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E4-S41-F1 Story 4.1: Build AIUsageFlow From Wizard and Technical Evidence` | 3 | `C` | `4.1` | `none` | `` |
| `E4-S42-F1 Story 4.2: Preserve TechnicalProfile and AIUsageFlow Separation` | 3 | `C` | `4.2` | `none` | `` |

## Epic 5 - Reconciliation and Verified Profile

Stories: `5.1`, `5.2`, `5.3`, `5.4`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E5-S51-F1 Story 5.1: Detect Material Profile Conflicts` | 3 | `C` | `5.1` | `none` | `` |
| `E5-S52-F1 Story 5.2: Explain Conflict Score and Evidence Basis` | 3 | `C` | `5.2` | `none` | `` |
| `E5-S53-F1 Story 5.3: Manager Conflict Resolution` | 3 | `A` | `5.3` | `none` | `` |
| `E5-S54-F1 Story 5.4: Preserve Scanner Evidence During Resolution` | 3 | `A` | `5.4` | `none` | `` |

## Epic 6 - Legal Corpus and Matching

Stories: `6.1`, `6.2`, `6.3`, `6.7`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E6-S61-F1 Story 6.1: Ingest Official Legal Source Snapshot` | 3 | `D` | `6.1` | `none` | `` |
| `E6-S62-F1 Story 6.2: Parse Legal Structure and Stable Hierarchical IDs` | 3 | `D` | `6.2` | `none` | `` |
| `E6-S63-F1 Story 6.3: Approve LegalCorpusVersion` | 3 | `D` | `6.3` | `none` | `` |
| `E6-S67-F1 Story 6.7: Create LegalMatchingResult and LegalRuleMatch Evidence` | 3 | `D` | `6.7` | `none` | `` |

## Epic 7 - Classification

Stories: `7.3`, `7.5`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E7-S73-F1 Story 7.3: Use Real LLM Provider With Schema and Budget Guardrails` | 3 | `L` | `7.3` | `none` | `` |
| `E7-S75-F1 Story 7.5: Validate Classification Citations Against Legal Allowlist` | 3 | `A` | `7.5` | `none` | `` |

## Epic 8 - Reporting and Audit

Stories: `8.1`, `8.3`, `8.6`, `8.7`

| Task | Pts | Owner | Story | Dependency | Window |
|---|---:|---|---|---|---|
| `E8-S81-F1 Story 8.1: Generate GapAnalysis From Classification and Evidence` | 3 | `D` | `8.1` | `none` | `` |
| `E8-S83-F1 Story 8.3: Generate Guarded Final Report` | 3 | `D` | `8.3` | `none` | `` |
| `E8-S86-F1 Story 8.6: Record Immutable Assessment Audit Trail` | 3 | `L` | `8.6` | `none` | `` |
| `E8-S87-F1 Story 8.7: View and Export Redacted Audit Trail` | 3 | `L` | `8.7` | `none` | `` |

## Practical Jira Rule

- Import `Epic` first, then `Story`, then `Task`.
- Fill `Epic Link` in story/task CSV after Jira returns new epic issue keys.
- Use `Task` as the only dev-assigned implementation item.
- Keep `Story` open until all mapped `Task` items are done and acceptance passes.
- Do not create `Sub-task` items in the new project.
