---
title: 'Readiness Export PDF Demo Script'
type: 'chore'
created: '2026-08-05'
status: 'in-review'
baseline_commit: 'c779cd720fad3d0d7f3546daebcb55909f48b498'
review_loop_iteration: 0
context:
  - '{project-root}/docs/project-context.md'
  - '{project-root}/docs/implementation-artifacts/2-4-wizard-readiness-export.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Developers need a repeatable way to inspect an actual Wizard Readiness Export PDF without manually preparing a Manager session, assessment, submitted Wizard profile, or PDF download request.

**Approach:** Add an API-local demo command that resets only the disposable test database, seeds the existing Manager/Wizard fixture, generates a readiness export through the real NestJS endpoint, downloads its PDF, and writes it to a gitignored `output/` path.

## Boundaries & Constraints

**Always:** Use the existing `lcsp_api_test` database, test auth fixture, Manager RBAC policy, readiness-export HTTP endpoints, and PDF download endpoint. Produce a readiness-only PDF with no accepted technical evidence. Print the output path and fail with a non-zero exit code for setup, generation, download, or file-write errors.

**Ask First:** Adding a PDF library, changing application endpoints, changing the main development database, or deleting files outside the generated demo PDF requires explicit approval.

**Never:** Connect to production data, accept external command-line values as unvalidated database URLs or output paths, commit generated PDFs, bypass Manager RBAC, or replace the existing e2e test fixture semantics.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|---------------|----------------------------|----------------|
| Demo succeeds | Docker test Postgres available | A version-one readiness-only PDF is saved at `output/readiness-export-demo.pdf`; the path and byte count are printed | N/A |
| Test database unavailable | Docker Desktop stopped or port unavailable | No PDF is written | Exit with the Docker/Postgres setup failure |
| Export/download fails | Fixture, RBAC, or API assertion fails | No stale success message is printed | Exit non-zero with the failure detail |

</frozen-after-approval>

## Code Map

- `apps/api/test/wizard-readiness-export.e2e-spec.ts` -- canonical fixture and endpoint interaction to reuse.
- `apps/api/test/support/auth-workspace-test-helpers.ts` -- test database reset, schema push, and Manager policy fixture.
- `apps/api/test/scripts/ensure-test-postgres.mjs` -- disposable PostgreSQL container setup.
- `apps/api/jest.config.ts` -- discovers focused non-e2e verification under `test/`.
- `apps/api/package.json` -- API-local runnable script declaration using the TypeScript compiler loader required for Nest decorator metadata.
- `.gitignore` -- excludes generated demo output.

## Tasks & Acceptance

**Execution:**
- [ ] `apps/api/scripts/demo-readiness-export-pdf.ts` -- bootstrap the test application, prepare only test data, generate and download the PDF through real HTTP endpoints, then atomically write the demo file -- gives developers an inspectable end-to-end artifact.
- [ ] `apps/api/package.json` -- add `demo:readiness-export-pdf` using the existing `tsx` runner -- exposes one documented command.
- [ ] `.gitignore` -- ignore `output/` generated demo artifacts -- prevents binary output from entering source control.
- [ ] `apps/api/scripts/demo-readiness-export-pdf.spec.ts` or an equivalent focused verification -- cover the output-path and HTTP success checks without requiring a browser -- prevents script drift.

**Acceptance Criteria:**
- Given Docker-backed test Postgres is available, when `pnpm --filter @lcsp/api demo:readiness-export-pdf` runs, then it uses the Manager fixture to generate and save a non-empty PDF beginning with `%PDF-` at `output/readiness-export-demo.pdf`.
- Given a generated PDF is inspected, then it contains readiness-only title, badge, missing-evidence, and unresolved-unknown sections, and no risk or legal-conclusion wording.
- Given the test database is unavailable or any endpoint returns a problem envelope, when the command runs, then it exits non-zero without claiming success.

## Design Notes

The command deliberately reuses HTTP endpoints instead of calling the PDF service directly. This tests the same RBAC, ownership, state-gate, persistence, guardrail, and download behavior as the real Manager-facing flow while isolating all writes to the disposable test database.

## Verification

**Commands:**
- `pnpm --filter @lcsp/api demo:readiness-export-pdf` -- expected: writes `output/readiness-export-demo.pdf`, prints its path, and exits zero.
- `file output/readiness-export-demo.pdf` -- expected: from the project root, reports a PDF document.
- `pnpm typecheck` -- expected: passes.
