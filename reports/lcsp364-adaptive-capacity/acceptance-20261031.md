# LCSP-364 — isolated canary continuation, 2026-10-31

Status: implementation verified locally; production for this revision remains UNEXECUTED/BLOCKED until the receipts below are completed. No merge or Done transition.

## A. Baseline and implementation

Verified develop is aa2ce4f3f7c5b1b6375eaf659bee0197aa61803b; PR #442 started this round at d68f748882f3999512276a4794defbc135b7b95f. Fogewise remains rollback revision 44dba336f332d566d3fee9fc0d32642a402d024e. Prior A failure and 752 deployment/rollback history are retained in rollout-20261031.md.

## B. Root cause

Canary A has RUNNING/FAILED execution-state events and a transport UUIDv7 absent from the Fogewise server store, with zero physical reservations. The new claimRoot binds a physical slot before RUNNING, so these writes did not pass the intended upgraded authority path. Shared DB outbox publishers are not broker-affine: any API can lock PENDING work and publish to its own configured broker. Original publisher identity and terminal runtime error were not durably recorded; they remain UNKNOWN. Lack of credit is not established as the cause. Fresh Fogewise process configuration agrees with its loopback broker and server.

## C. Architecture

Opt-in AssessmentExecutionIsolation pins a new, unstarted test Assessment to the upgraded PostgreSQL login. OWNED_PENDING hides its pending/retrying outbox from old publishers; only the enrolled login may select it. Database mutation fences cover the Assessment, outbox and assessmentId-bearing canonical tables. Existing global admission/leases/checkpoints/legal/payment gates stay authoritative. An unrelated external instance is left untouched; scoped isolation is not global quiescence.

## D. Changes and commits

Additive migration, shared status mapping, authorized outbox selection, compiled public operations export, exact-test-account grant/reversal and enrollment scripts, real PostgreSQL/RabbitMQ regression, CI step and runbook. Exact pushed SHA and deployed image will be recorded after commit.

## E. Automated tests

- New PostgreSQL roles/kernel/audit/RabbitMQ: 7 PASS, zero provider calls.
- Global admission PostgreSQL: 17 PASS plus real SDK/broker 10,001-command regression.
- Policy/outbox focused: 98 PASS.
- Business documentation checker tests: 5 PASS; production docs/import/contracts/lint/schema/build gates PASS.
- Full API: 187 suites / 1,561 tests PASS, 15 suites / 146 tests skipped; 343.419 seconds. Exact-head remote CI remains pending at report creation.

## F. Production deployment

Pending. Fresh read-only preflight recorded ~4.315 GiB free and ~5.05 GB available memory, native local runs zero, one unrelated external live lease. Require fresh gate before maintenance/build. Preserve rollback archive, existing sandboxes and unrelated services.

## G. Actual load/concurrency evidence

No new production execution claimed. Existing provider-free 1/2/4/8 evidence remains separate from paid/native production.

## H. Stop/Continue, HITL and isolation

Pending production. Foreign-login mutation, SET ROLE impersonation, deletion/ownership-move and old-publisher selection tests PASS locally. Enrollment refuses started/historical work.

## I. Resources, provider and monetary governance

User authorized an INTERNAL_TEST_GRANT through appendLedger only. Script grants 1,000,000 credits to the exact verified acceptance customer and audits atomically, with fixed idempotency and reversal. Production grant not yet applied. No SePay order/payment/webhook, policy bypass or direct wallet update. Existing model-credit debits are retired in the kernel; wallet debit and provider cost must be reconciled separately, UNKNOWN remains UNKNOWN.

## J. Screenshots, traces and rollback

Pending current-revision production. Policy disable/drain is the supported rollback while protected work is unfinished. Do not remove the fence or run old code against unfinished isolated Assessments.

## K. Acceptance and verdict

Production-native, Stop/Continue, HITL, adaptive execution, paid reconciliation and current-head CI remain BLOCKED/unexecuted at this checkpoint. Prior CHANGES_REQUESTED review remains required; no merge/Done.
