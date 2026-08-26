---
artifact_type: module_task_index
authority: docs/implementation/tasks/README.md
---

# LCSP Module-Scoped Feature Task Index

Each file here is one **implementable feature unit** within one module. Every task has complete coding information: exact file paths, API contract, Prisma models, commands/events, RBAC rules, and test cases.

## Why Small Tasks

A large task like "Organization and Assessment APIs" is ambiguous—a developer does not know which file to open first. A small task like "Create Assessment Endpoint" has one output, one set of files, and one verifiable acceptance.

## Task File Format

```
---
task_id: MW-<module>-<NNN>
module: <module>
runtime: nestjs-api | deepagents | web | cross-runtime
priority: P0 | P1
status: READY_FOR_DEV | IN_PROGRESS | DONE
epic_story: <story-id>
depends_on: [<relative-path>, ...]
---
```

Every task file contains:
- **Outcome** — one sentence
- **Module Files** — exact paths + action (Create/Modify/Verify)
- **API Contract** — endpoint, request, response, errors (for API tasks)
- **Worker Handler** — command, input, output, idempotency (for worker tasks)
- **Prisma Models Used** — table, action, fields
- **Business Rules** — the invariants the implementation must enforce
- **Commands / Events** — names, types, payloads
- **RBAC** — who can call this, what guard checks
- **Test Cases** — ID, scenario, expected result
- **Definition of Done**

## Module Directory Map

| Directory | Runtime | Covered stories | Task count |
|---|---|---|---|
| `auth-workspace/` | nestjs-api | 1.1–1.8 | 16 (01–16) |
| `assessment/` | nestjs-api | 2.1, 2.3 | 3 (01–03) |
| `wizard/` | nestjs-api | 2.2–2.4 | 4 (01–04) |
| `github-integration/` | nestjs-api | 3.1–3.3 | 4 (01–04) |
| `scan/` | nestjs-api | 3.3, FR-049 | 3 (01–03) |
| `evidence/` | nestjs-api | 3.5–3.6 | 2 (01–02) |
| `ai-usage-flow/` | nestjs-api | 4.2 | 1 (01) |
| `reconciliation/` | nestjs-api | 5.1–5.4 | 4 (01–04) |
| `classification/` | nestjs-api | 6.1–6.2 | 2 (01–02) |
| `document/` | nestjs-api | 7.1–7.3 | 3 (01–03) |
| `audit/` | nestjs-api | 8.1–8.2 | 2 (01–02) |
| `platform/config/` | nestjs-api | 1.1 | 1 (01) |
| `platform/audit-writer/` | nestjs-api | 1.8 | 2 (01–02) |
| `platform/outbox/` | nestjs-api | 2.1 | 3 (01–03) |
| `platform/rbac/` | nestjs-api | 1.6–1.7 | 4 (01–04) |
| `python-workers/platform/` | deepagents | cross-worker | 4 (01–04) |
| `python-workers/scanner/` | deepagents | 3.4–3.5 | 15 (01–15) |
| `python-workers/intelligence/` | deepagents | 3.6, 4.2, 5.1, 5.4 | 4 (01–04) |
| `python-workers/legal/` | deepagents | 6.1 | 1 (01) |
| `python-workers/llm/` | deepagents | 4.1 | 1 (01) |
| `python-workers/classification/` | deepagents | 6.2 | 1 (01) |
| `python-workers/reporting/` | deepagents | 7.1–7.2, 8.2 | 3 (01–03) |
| `web/` | nextjs | 1.2, 1.4, 2.2, 5.3, 7.3 | 6 (01–06) |
| `qa/` | all | cross-module | 3 (01–03) |

## Dependency Order (Build Sequence)

```
platform/config → platform/audit-writer → platform/outbox → platform/rbac
                                                          ↘
auth-workspace (sign-in, mfa, oauth, org, invitation) ← rbac
                                                       ↘
assessment → wizard → github-integration → scan
                                         ↘
python-workers/platform → python-workers/scanner → python-workers/intelligence
                                                 ↘
python-workers/legal → python-workers/llm → python-workers/classification → python-workers/reporting
                                                                           ↘
document → audit → web → qa
```
