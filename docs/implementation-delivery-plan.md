# LCSP Implementation Delivery Plan

This delivery plan is synchronized to the active module-scoped task catalog. The former coarse-grained engineering task list was removed; build routing now uses `MW-*` task IDs from `docs/implementation/tasks/modules/**`.

## Active Sources

- Module task catalog: `docs/implementation/tasks/modules/README.md`
- Generated module summary: `docs/implementation/tasks/README.md`
- Developer task index: `docs/developer/task-index.md`
- Jira import CSVs: `docs/developer/jira-lcsp-*.csv`

## Delivery Constraints

- Platform config, audit, outbox, and RBAC gates must precede dependent feature modules.
- Repository snapshot precedes scan jobs.
- Scanner evidence assembly precedes TechnicalProfile generation.
- TechnicalProfile and AIUsageFlow precede reconciliation and VerifiedProfile.
- VerifiedProfile and legal retrieval precede classification.
- Classification precedes gap analysis and final report generation.
- Web and QA tasks bind only to stable API contracts or explicitly mocked contracts.

## Current Build Sequence

1. Platform foundation: `platform/config`, `platform/audit-writer`, `platform/outbox`, `platform/rbac`.
2. Workspace foundation: `auth-workspace`, then web sign-in/workspace surfaces.
3. Assessment and wizard: `assessment`, `wizard`, then wizard web surface.
4. Repository and scan: `github-integration`, `scan`, `python-workers/scanner`, `evidence`.
5. Intelligence: `python-workers/intelligence`, `ai-usage-flow`, `reconciliation`.
6. Legal/classification/reporting: `python-workers/legal`, `python-workers/llm`, `classification`, `python-workers/classification`, `document`, `audit`, `python-workers/reporting`.
7. Acceptance: `qa` module tasks.

## Non-Claims

- This plan is not a sprint commitment.
- It does not authorize code before story status and dependency checks pass.
- Generated Jira CSVs are import artifacts, not independent source of truth.
