# PR #456 — CI fixes and independent PostgreSQL migration proof

**Date:** 2026-11-04
**Scope:** Draft PR [#456](https://github.com/khov4nfs/LCSP/pull/456). No production connections, database writes or paid model calls.

## Root cause

1. **API route allowlist drift:** Four new `/admin/compliance-rule-sets/preparations/:preparationRunId/scope-reviews` endpoints were registered in the Admin controller, but `apps/api/src/app.routes.allowlist.json` was not updated. `src/app.routes.spec.ts` failed exact route surface verification. This also failed API coverage and the V2 aggregate release gate.
2. **Generic runtime architecture regression:** `development-scope-review.ts` introduced a legal actor category term in a JSDoc comment. The repository-wide domain-neutral runtime scanner in `test_assessment_root_agent.py::test_generic_runtime_code_names_no_legal_role_category_or_instrument` correctly rejected the string. No executable logic needed modification.

## Fix

- Registered the four explicit reviewed Admin endpoints in the sorted allowlist; did not delete or weaken the exact-match test.
- Reworded the validation function's JSDoc to describe out-of-scope obligations generically. Actor/stage authority remains governed by source-pinned claim data and human review.
- Added repeatable disposable PostgreSQL SQL assertions in `apps/api/test/scripts/scope-review-migration.smoke.sql`. The file refuses non-test database names and non-PostgreSQL-16 servers, performs all fixture work in one transaction and rolls it back.

## Independent PostgreSQL 16 verification

- **Engine:** PostgreSQL **16.15**, standalone `postgres:16-alpine` Docker container.
- **Database:** `lcsp_pr456_disposable`, bound to localhost only. This is an independently initialized empty database, not a restored or copied production database.
- **Migration:** `prisma migrate deploy` exited successfully, applying **144 migrations**, including `20261104120000_preparation_scope_review_ledger`.
- **Idempotency:** A second migrate deploy reported no pending migrations. `prisma migrate status` returned `Database schema is up to date!` and PostgreSQL `_prisma_migrations` contained 144 successful records, including the new migration.
- **Data-level assertions (11/11 PASS):** persisted scope request and default FULL_SOURCE; ledger row persisted; mismatched legal-source composite FK rejected; missing frozen-inventory revision rejected; duplicate review row rejected; APPROVED without approver rejected; APPROVED without timestamp rejected; complete approval metadata accepted (independence is enforced by the application service); illegal reversal to DRAFT with retained approval metadata rejected; frozen inventory mutation rejected.
- **Cleanup:** The SQL fixture transaction explicitly ROLLBACKed. A post-rollback query returned **0** fixture review rows.

Re-run the SQL assertions **only after** a disposable PostgreSQL 16 database has received all Prisma migrations:

```bash
# From repository root; must be a disposable postgres:16 database.
docker exec -i <disposable-postgres-container> \
  psql -X -v ON_ERROR_STOP=1 -U postgres -d <disposable-db> \
  < apps/api/test/scripts/scope-review-migration.smoke.sql
```

## CI repair verification

- Targeted API Jest: `app.routes.spec.ts`, scope domain and scoped review persistence service: **14 tests PASS**.
- Python architecture guard: `test_generic_runtime_code_names_no_legal_role_category_or_instrument`: **PASS**.
- Business-logic documentation: **0 new violations**.
- Changes preserve original strict route registration and generic legal runtime invariants.

**Limitations:** This validates the actual PostgreSQL DDL, foreign keys, approval constraints and inventory immutability, not a paid `DEVELOPMENT_ONLY` agent run or independent legal meaning. GitHub Actions on the final commit and release approval must still pass. No merge or production deploy is authorized by this smoke test alone.
