# LCSP-347 UI-02 Preparation Entry Point Handoff

## Root cause

At baseline `819018b0ed4da210129e75a23d7c15d905605394`, the Admin action component returned `null` whenever `canStart`/`canReplace` was false and there was no current run. The availability loader returned the same generic refusal for zero, multiple, and structurally ineligible active sources. The history loader also mapped every `SUCCEEDED` execution to `RULE_SET_READY`, even without a persisted authoring draft or Rule Set Version.

## Fix

- Keep the singleton ACTIVE-source policy. Multiple ACTIVE sources now return the explicit `ACTIVE_SOURCE_AMBIGUOUS` refusal and do not select either source. Up to two bounded source identities and their source-evidence readiness are shown as diagnostics only.
- Keep the Prepare entry point visible at the top of the Admin page. It displays the selected source identity, current run, Active Rule Set identity, and `DEVELOPMENT_ONLY` scope. It disables the action and explains the backend refusal with an authorized next step.
- Keep the exact source ID in the confirmation and request. The request includes `DEVELOPMENT_ONLY`; the server still compares the expected source with its current eligibility decision.
- Project execution success without a persisted Rule Set or validated persisted draft as `SUCCEEDED_WITHOUT_ARTIFACT`. A validated persisted draft and a persisted Rule Set Version receive separate stage labels; ACTIVE remains separate.
- No migration or canonical record mutation was made.

## Read-only local diagnostic

The database was verified by name as `lcsp_dev_lcsp347`. Queries ran inside `BEGIN READ ONLY` transactions and ended with `ROLLBACK`.

| ACTIVE source | Integrity ref | Valid retrieval index | Matching activation row | Documents | Chunks | Preparation eligible |
|---|---|---:|---:|---:|---:|---:|
| `ea43540c-513e-4b76-969a-8415f06696f2` / `lcsp-360-official-eight-document-acceptance-corpus.v1` | present | 1 | 0 | 0 | 0 | No |
| `3edc9c2a-4900-4c5a-a4a0-660cf99639fc` / `vn-ai-official-2026.v3` | present | 1 | 0 | 0 | 0 | No |

Current Active Rule Set Versions: `0`.

Historical run `630eed1a-1577-4ca7-84bc-4ba17df911f1` is `SUCCEEDED` (`2026-10-25T23:33:37.593Z`), `DIRECT_DRAFT_V1`, `FULL_SOURCE`, and has a passed validation result. It has no Rule Set Version association and no persisted authoring-draft revisions. Its original import/authoring provenance cannot be established from the available persisted records; it is therefore shown as a historical successful execution without an artifact, not rewritten as failed and not promoted to readiness.

Unauthenticated `GET http://localhost:3000/api/admin/compliance-rule-sets` returned HTTP `401`; no authenticated API payload was available for this handoff. The expected multiple-source refusal is covered by a backend loader test.

## Verification

- Runtime contract packages and i18n build: PASS.
- Focused Web Admin cases (eligible start, ambiguity/candidate diagnostics, EN/VI blocker copy, in-progress disablement, explicit replacement, source/scope request, historical success without artifact): 7 PASS.
- API Preparation handler and availability/history stage tests: 3 suites, 26 tests PASS.
- TypeScript project build including Prisma generation: PASS.
- Import policy, contract literal policy, API/Web targeted ESLint, business-logic docs gate, contract/i18n builds: PASS.
- Full Admin test file: not completed. An earlier full-file attempt encountered an `Array buffer allocation failed` in the existing active-rule-set test after the first ten cases; that test was updated for the visible replacement CTA and passed in isolation. All seven focused Admin cases passed on the final code.
- Browser: Playwright opened the running local application, which redirected the unauthenticated context to `/sign-in` (HTTP 200, zero console errors). The authenticated Admin workflow was not browser-verified. Screenshot: `reports/lcsp347-ui02-browser-smoke.png`.

## Authority and operations

## UI-02.1 verification follow-up

- Remote HEAD reconfirmed as `819018b0ed4da210129e75a23d7c15d905605394`; existing worktree preserved.
- Corrected two remaining obsolete test expectations: an unavailable source now has a visible disabled action, and an explicit replacement includes the displayed DEVELOPMENT_ONLY scope.
- Full `apps/web/tests/compliance-rule-sets-page.test.tsx`: 19 passed, 0 failed, 0 skipped. Evidence: local `reports/ui02-web-tests.log`. React act warnings remain in timer/stream cases.
- Focused API suites rerun: 26 passed. Targeted API and Web ESLint passed. TypeScript build and import policy passed. Contract policy and business documentation checks passed on a sequential rerun; an earlier overlapping run exhausted memory while the old DOM assertion was failing.
- The unavailable-source assertion compared a DOM element with null; printing the failed assertion exhausted memory. Updating the assertion to verify the visible disabled button allowed the complete file to finish without raising memory limits.
- Workflow `43033829458` failed during Ubuntu dependency installation with `Temporary failure resolving azure.archive.ubuntu.com`. Requested a failed-job rerun on the same baseline SHA; attempt 2 was IN_PROGRESS at collection time.
- Authenticated browser verification and credential rotation remain outstanding. No approved real Admin session was established. Fixture tokens were not used to bypass real authentication.
- No commit or push has been performed in this follow-up. Publication remains pending required authenticated verification and final operational checks.

- The current local database has two ACTIVE rows and neither is eligible under the singleton/source-evidence policy. No source was selected automatically or changed.
- The requested `lcsp-360` source is not currently eligible. An authorized source administrator must resolve the ACTIVE-source ambiguity and restore/verify source activation and source-document/chunk evidence before Preparation is available.
- No Preparation was started. Paid model calls: `0`. Source/Rule Set/database mutations: `0`.
- PR #456 remains OPEN/Draft. No merge or deployment was performed.
