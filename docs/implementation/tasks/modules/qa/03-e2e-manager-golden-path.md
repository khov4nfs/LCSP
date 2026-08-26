---
task_id: MW-qa-003
module: qa
runtime: all
priority: P1
status: DONE
epic_story: 2.1
depends_on:
  - web/06-document-download-page.md
  - python-workers/reporting/02-final-report-worker.md
---

# E2E Manager Golden Path Test

## Outcome

End-to-end test covering the complete Manager workflow from registration to final report download without any external collaborator assignment. Validates that the system works fully Manager-only and that every gate check functions correctly.

## Module Files

| File                                    | Action | Notes                          |
| --------------------------------------- | ------ | ------------------------------ |
| `tests/e2e/manager-golden-path.spec.ts` | Create | Playwright E2E test            |
| `tests/e2e/helpers/api-seed.ts`         | Create | Seed test org + Manager policy |

## Golden Path Steps

1. Manager signs up or uses seeded account → account created
2. Manager signs in → workspace visible
3. Manager creates assessment
4. Manager completes Wizard → submits
5. Manager connects GitHub repository (mock GitHub API responses)
6. Manager pins commit snapshot
7. Manager triggers scan (mock scanner worker callback)
8. Manager views evidence findings
9. Manager reviews conflict list (mock conflict detection callback)
10. Manager resolves all conflicts
11. Manager views classification status (mock classification callback)
12. Manager generates final report (mock reporting worker callback)
13. Manager downloads final report via pre-signed URL

## Key Assertions

- Manager completes full flow without external collaborator
- No risk labels appear at any step
- Session token never in URL
- All RBAC-gated actions allowed for Manager
- Classification lock removed after evidence accepted
- Final report download available after `guardrail = passed`

## Definition of Done

- Full golden path passes in CI.
- Manager-only flow validated end-to-end.
- No risk labels at any UI step.
- RBAC enforce verified at each server call.
