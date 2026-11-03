# LCSP-364 — Final acceptance (A–K)

Current decision: **BLOCKED REQUIRED** pending exact-head CI and affected production activation/canary. Independent review is also required. The local correctness gates below have passed; no merge, release approval or Jira Done is claimed.

## A. Exact baseline and source identity

Verified at the start of this completion pass: local/GitHub PR #442 HEAD `529e30c7d386e10133d9d170425e5fd3449b4589`, OPEN; 37/37 SUCCESS rollup check-run contexts verified on GitHub Actions. The latest independent evidence review explicitly accepts the isolated real-provider two-Root proof and confirmed resolution of prior P1s. Fogewise is still `2cd94a65e26397a1bb486a6ba4de2c168d152192`, 140 applied migrations, healthy API, 4,799,131,648 free disk bytes and zero held physical slots. [Read-only baseline](final-baseline-production.json). SourceNerve workspace discovery currently returns -32603; GitHub/Jira and repository graph tools remain available. No claim is based solely on historical memory.

## B. Confirmed root causes and corrections

The original fixed executor design and both reviewed P1 corrections remain described in the historical reports. The reviewer accepted both P1 fixes on `7528577c0`: exact eligibility is separate from the 10,000-row fairness window, and `/runs/wait` is removed.

### Confirmed P1 remediation: Operator DLQ replay atomicity and state transition contract

**Root cause:**
Inspection of `OutboxDlqService.replayMessage()` and `OutboxRepository.resetMessageForReplay()` identified five concurrent failure vectors breaking atomic recovery:
1. *Preflight validation outside the transaction:* Eligibility verification (`assertReplayTargetIsSafe`) executed before acquiring locks and outside the reset transaction in `outboxRepository.resetMessageForReplay(id)`.
2. *Unconditional outbox status update:* If a physical execution slot was claimed concurrently between validation and transaction execution, the repository skipped resetting `AssessmentRootAdmissionRequest` but still updated `OutboxMessage` status to `PENDING` (or trigger-rewritten `OWNED_PENDING`), violating writer isolation.
3. *Split audit persistence (Scenario A):* `AuditWriterService.write()` ran as an independent operation *after* the replay transaction committed. If audit persistence failed (transient network or DB fault), an authorized recovery command was released for publication with zero corresponding authorization audit record.
4. *Concurrent ADMIN replay races (Scenario B):* Two administrators issuing simultaneous replay requests on the same DLQ message could both observe DLQ state during preflight and attempt competing resets.
5. *Uncoordinated Replay vs Discard race (Scenario D):* `OutboxDlqService.deleteMessage()` and `OutboxRepository.deleteMessage()` checked message status outside the deletion boundary, allowing discard to overwrite an already reopened command, or stale replay to resurrect a discarded command. Furthermore, uncoordinated delete risked orphaning Root admission history.

**Correction and single-transaction architecture:**
The entire replay and discard workflows were refactored into strict, single-transaction boundaries with an explicit deadlock-free lock order:
- **Lock ordering:**
  1. `AssessmentRootCapacity` singleton row (`ROOT_CAPACITY_ID`) locked via `SELECT ... FOR UPDATE` (ensuring capacity authority serialization).
  2. `OutboxMessage` row (`id`) locked via `SELECT ... FOR UPDATE` (ensuring exclusive message lock).
  3. `Assessment` (`id`) and `AssessmentRuntime` (`assessmentId`).
  4. `AssessmentRootExecutionSlot` (evaluating held slots).
  5. `AssessmentRootAdmissionRequest` (conditional reset using `clock_timestamp()`).
- **Fail-closed atomic transition:**
  - In `replayMessage()`, message state is verified under the transaction lock to ensure `status === OUTBOX_STATUSES.dlq`.
  - Safety assertions (`assertReplayTargetIsSafeInTx`) revalidate Assessment `ACTIVE`, runtime `FAILED`, `leaseToken === null`, held slot count === 0, and non-fenced error codes under the row lock.
  - For Root commands, `AssessmentRootAdmissionRequest` is reset atomically (`completedAt = NULL`, `admittedRunId = NULL`, `deliveredAt = NULL`, `requestedAt = clock_timestamp()`). If no rows are updated, the transaction throws and rolls back.
  - `OutboxMessage` update is strictly conditioned: `UPDATE ... WHERE id = $id AND status = 'DLQ'`. The database trigger `lcsp_assessment_execution_writer_fence` automatically enforces `OWNED_PENDING` isolation for enrolled Assessments.
  - Positive audit `OUTBOX_AUDIT_EVENT_TYPES.dlqReplayed` is committed inside the exact same transaction via `auditWriter.writeInTx(..., tx)`. If audit persistence throws, the entire transaction rolls back cleanly.
  - Denial audits (`OUTBOX_AUDIT_EVENT_TYPES.dlqReplayDenied`) are logged in an isolated transaction upon caught precondition rejections, preventing false success.
- **Authoritative discard and tombstone semantics:**
  - `deleteMessage()` executes within the same locking hierarchy. If a Root command is referenced by durable admission records, its status is conditionally transitioned to `CANCELLED` tombstone (`WHERE status = 'DLQ'`), preserving historical admission references and preventing resurrection. Unreferenced non-Root events are physically deleted.
  - Discard audit `OUTBOX_AUDIT_EVENT_TYPES.dlqDiscarded` is written atomically in-transaction via `writeInTx`.
- **Non-Root event regression protection:**
  - Ordinary outbox messages replay and discard cleanly without requiring Root admission bookkeeping.
  - Repository scan jobs with terminal states (`COMPLETED`, `FAILED`, `CANCELLED`) are strictly refused replay.

### Review ID 5746109761 Remediation: Discard Quiescence & Test Safety

Following independent review `5746109761` (`CHANGES_REQUESTED`), two additional P1 concerns and regression enhancements were addressed:

1. **P1 — Refuse Discard During Active Physical Execution:**
   - *Root cause:* `OutboxDlqService.deleteMessage()` previously allowed an administrator to discard or tombstone a Root command even if its physical execution slot was still held (`releasedAt: null`) or runtime was `RUNNING`. When `finishExecution(recoveryRequired=true)` quarantined an unquiescent Root, a premature discard severed the recovery path while native execution was still active.
   - *Fix:* `deleteMessage()` now queries `tx.assessmentRootExecutionSlot` and `tx.assessment.runtime` under transaction locks. If any unreleased execution slot or non-quiescent runtime state is detected, the operation aborts with HTTP 409 CONFLICT (`OUTBOX_ERROR_CODES.dlqDiscardUnsafeTarget`) and writes an isolated denial audit `OUTBOX_AUDIT_EVENT_TYPES.dlqDiscardDenied`. Transport-level `OutboxRepository.deleteMessage()` preserves tombstoning without cascading away live capacity or admission intent.

2. **P1 — Test Isolation and Accidental Data Loss Prevention:**
   - *Root cause:* The e2e test suite `outbox-dlq-atomic-replay.e2e-spec.ts` previously invoked `pushPrismaSchema()` (which executes `DROP SCHEMA public CASCADE`) and utilized wide, unconstrained `deleteMany()` cleanup calls. Running against an improperly specified `DATABASE_URL` carried severe data loss risk.
   - *Fix:* Completely removed `pushPrismaSchema()` and table-wide deletes. Added a mandatory `assertDisposableDatabase()` pre-flight check in `beforeAll` enforcing that the test connects exclusively to a dedicated local test database (`localhost`/`127.0.0.1`, matching `lcsp_api_test`, `lcsp364_capacity`, or `*_test`). Replaced table-wide deletions with strict fixture-scoped ID tracking (`cleanTrackedFixtures`), isolating test effects to synthetic fixture entities.

3. **P2 & Regression Coverage Expansion:**
   - *Slot Acquisition Race (Test 12):* Added real-PostgreSQL test proving that if an execution slot is claimed concurrently before replay commits, the replay fails closed with `dlqReplayUnsafeTarget` and writes `dlqReplayDenied`.
   - *Deadlock Assertion Rigor (Test 9):* Upgraded the concurrent interleaving deadlock test to verify concrete post-condition database state (outbox status transitions to `OWNED_PENDING` / `CANCELLED`, attempts reset to 0, and exact audit records persisted).
   - *Repository Tombstone Verification (Test 13):* Proves low-level `outboxRepository.deleteMessage()` marks Root commands with admission intent as `CANCELLED` without deleting admission history or live capacity.

### Review ID 5746418610 Remediation: CI Database Allowlist, Repository Quiescence & Deterministic Race

Following independent review `5746418610` (`CHANGES_REQUESTED`), the following findings were remediated:

1. **P1 — E2E Database Allowlist CI Blocker:**
   - *Root cause:* The CI workflow for API E2E uses the dedicated disposable test database `lcsp_api_e2e` (ending in `_e2e`, not `_test`). `assertDisposableDatabase()` rejected this verified database name, failing all 13 E2E tests during `beforeAll` and subsequently triggering a `TypeError` in `afterAll` when `$disconnect` was invoked on uninitialized clients.
   - *Fix:* `assertDisposableDatabase()` now explicitly validates `["lcsp_api_test", "lcsp_api_e2e", "lcsp364_capacity"]` as well as any database name ending in `_test` or `_e2e` on `localhost`/`127.0.0.1`. In addition, error reporting omits raw credentials, and `afterAll` uses optional chaining (`prisma1?.$disconnect()`) with error suppression for resilient teardown.

2. **P2 — Repository Quiescence Enforcement (`OutboxRepository.deleteMessage`):**
   - *Root cause:* `OutboxRepository.deleteMessage()` bypassed the quiescence check present in `OutboxDlqService.deleteMessage()`, allowing a Root DLQ command with active physical execution slots (`releasedAt: null`) or active runtime state (`executionState === RUNNING` / active `leaseToken`) to be tombstoned to `CANCELLED`.
   - *Fix:* Added both active execution slot count and runtime execution status / lease checks to `OutboxRepository.deleteMessage()`. If `heldSlots > 0`, `executionState === RUNNING`, or `leaseToken != null`, it strictly rejects discard with `ROOT_EXECUTION_ACTIVE_CANNOT_DISCARD`. Both the low-level repository and high-level service now fail closed against non-quiescent execution.

3. **P2 — Deterministic Slot Acquisition Race Regression (Test 12):**
   - *Root cause:* Test 12 previously executed slot insertion and replay validation sequentially, rather than testing a true concurrent race, and initially relied on a 50ms heuristic delay.
   - *Fix:* Rewrote Test 12 to use real lock coordination between two concurrent PostgreSQL sessions: Session 2 acquires `AssessmentRootCapacity FOR UPDATE`, inserts an unreleased execution slot, and holds the lock while Session 1 dispatches `dlqService1.replayMessage()`. PostgreSQL blocks Session 1 at the row lock level.

4. **Integration Fix — Vertical Capacity Tests (`LEGACY_FULL` Mode):**
   - *Root cause:* PR #443 defaulted newly created assessment cases to `auditMode = CUSTOMER_SELECTED`. As a result, `completeRepositorySetup` did not enqueue legacy full-scope Root outbox commands, causing `adaptive-capacity-load.mjs` to encounter an undefined command in `Assessment Root vertical`.
   - *Fix:* Updated `adaptive-capacity-load.mjs` and `adaptive-capacity-faults.mjs` to explicitly set `auditMode = 'LEGACY_FULL'` prior to setup completion, matching the expected behavior for native load and fault runs.

### Review ID 5746775314 Remediation: Deterministic Replay Waiter Barrier via `pg_blocking_pids`

Following independent review `5746775314` (`COMMENTED`), the lock waiter verification in Test 12 was hardened:

1. **P2 — Waiter Session Correlation via `pg_blocking_pids`:**
   - *Root cause:* Querying `pg_locks WHERE NOT granted` in Test 12 matched any lock waiter across the entire PostgreSQL instance. It did not prove that the waiter was specifically the `replayMessage()` transaction on Session 1, nor that Session 1 was blocked specifically on Session 2's `AssessmentRootCapacity` lock. Any extraneous lock contention could have satisfied the waiter condition spuriously.
   - *Fix:* Enhanced Test 12 to establish an exact, verifiable per-session blocking relationship:
     - Session 2 retrieves its own backend PID within its transaction: `SELECT pg_backend_pid() AS "holderPid"`.
     - While holding the `AssessmentRootCapacity` row lock and unreleased execution slot, Session 2 polls `pg_stat_activity` with an explicit barrier:
       ```sql
       SELECT count(*)::int AS count
       FROM pg_stat_activity a
       WHERE ${holderPid} = ANY(pg_blocking_pids(a.pid))
         AND a.query ILIKE '%AssessmentRootCapacity%'
       ```
     - Session 2 commits and releases its lock *only* after PostgreSQL confirms that a backend session whose active query targets `AssessmentRootCapacity` is actively blocked by `holderPid`.
     - Session 1 unblocks, observes the committed slot, and fails closed with `dlqReplayUnsafeTarget`, proving deterministic fence enforcement under true concurrency without heuristic delays or ambient lock false-positives.

Confirmed security gap: the actual non-superuser Fogewise API login could UPDATE/DELETE enrollment, removing the canonical-row fence. The additive immutable-enrollment trigger now rejects this DML, TRUNCATE and impersonation, and validates new enrollment under the activation lock. [RED](final-isolation-red.log), [GREEN: 8/8](final-isolation-green.log). Existing production enrollments have not been modified.

Active fault injection found two further defects. Identical redeliveries could occupy both polling workers and starve independent work; a bounded fingerprint guard now defers duplicates through the existing confirmed durable delay. A replacement could accept the previous lease/run ID and replay a model step whose external response was unknown. Registration now atomically revokes the old lease pair, claims require the current incarnation, and uncertain running work enters existing durable DLQ before another model invocation. Audited quiescent ADMIN replay preserves the same Root/checkpoint. [Original active failure](final-active-faults-red.json), [duplicate starvation](final-active-faults-duplicate-starvation.json), [10-scenario GREEN](final-active-faults.json).

Explicit retry originally compared the completed turn with old outbox creation time, incorrectly consuming the new request. It now uses the refreshed DB-clock admission request time. A materialized owner aggregate prevents repeated history scans under large-backlog query plans. The actual 10,001-command PostgreSQL/RabbitMQ regression passes with terminal-turn retry coverage. Initial test iterations also caught a lease-pair SQL constraint violation and a nonexistent admission column; both were corrected before publication/rollout.

## C. Supported execution topology

One authoritative Agent Server, bounded physical executors, shared API/PostgreSQL admission and one canonical decision-owning Root per Assessment. Supported API/bridge replicas use the same authority and server endpoint. Effective admission scales inside the authorized physical ceiling. Horizontal Agent Server replication remains unsupported.

A scoped mixed-version rollout must technically exclude legacy logins/publishers from newly enrolled execution. It is not production-wide adoption. Global enablement outside that scope remains refused until all participating writers enforce admission or are excluded. Enrollment hardening is mandatory even for the scoped mode.

## D. Changes and migrations

Changes: additive migration `20261102043000_assessment_execution_isolation_immutable`; incarnation context/claim binding; old-lease fencing; fail-closed Root recovery and existing ADMIN DLQ retry; duplicate poller backpressure; retry eligibility; caller/fixture/CI integration. No historical data backfill or migration rewrite. The preflight records denied optional checkpoint reads as UNKNOWN instead of failing an otherwise valid least-privilege inventory.

## E. Exact-head automated and distributed verification

Local source-bound receipts:

| Verification | Result | Receipt / scope |
|---|---|---|
| DLQ Atomic Replay / Concurrent Recovery Invariants | 13 PASS | [Test](apps/api/test/outbox-dlq-atomic-replay.e2e-spec.ts); real PostgreSQL concurrency (ports/pools), atomic rollback on audit failure, racing replay/discard, physical slot fencing, discard quiescence guard, non-Root events, deadlock immunity, exact `pg_blocking_pids` session barrier |
| Real PostgreSQL Global Admission / Capacity Integration | 18 PASS / 1 SKIP | [Test](apps/api/test/assessment-root-capacity.integration.spec.ts); dedicated `lcsp364_capacity` database, out-of-order 10k deferrals, independent API pools, terminal callback quiescence, tenant rotation, failover fences |
| Outbox Platform Unit Suite | 87 PASS (6 suites) | [Suite](apps/api/src/platform/outbox/); DLQ controller/service, discard quiescence denial, repository transaction propagation, RabbitMQ publisher, payload isolation |
| Assessment Domain & Application Suite | 349 PASS (33 suites) | [Suite](apps/api/src/modules/assessment/); root capacity policy, admission gate, recovery services, tracking, provenance, legal source queries |
| Python Adaptive Root Capacity Suite | 32 PASS | [Suite](deepagents/tests/test_adaptive_root_capacity.py); fault harness, path traversal prevention, cgroup memory limits, capacity refusal signals, incarnation fencing |
| Full Python | 2,037 PASS / 26 SKIP | [Log](final-python-regression.log); includes usage/cache/failure/budget/semantic/runtime tests; skipped integrations are not PASS |
| Full API | 1,575 PASS / 134 SKIP, 190 suites PASS | [Log](final-api-regression-green.log); actual dedicated migrated PostgreSQL, accounting/legal/provenance/isolation |
| Distributed admission / 10,001 commands | 19 PASS | [Log](final-capacity-integration.log); real PG pools, HTTP, RabbitMQ retry/ACK, owner rotation and nonce fencing |
| Enrollment / authorized outbox / test ledger | 8 PASS | [Log](final-isolation-green.log); actual unprivileged roles, SET ROLE denial, ordinary events and kernel conservation |
| Active process faults | 10 scenarios PASS | [Receipt](final-active-faults.json); real APIs/bridges/server/PG/MQ/native checkpoints; external HTTP model is an explicit provider-free fixture |
| Native load 1/2/4/8 | 15 completed, peak 1/2/3/3 | [New receipt](final-native-load.json); real API/PG/MQ/native Roots, separate checkpoint DB, two owners, duplicate delivery and automatic idle scale-down; no paid provider |
| Legal/report lifecycle | 149 checks PASS | [Log](final-legal-report-vertical.log); labeled synthetic completed fixture, legal negative controls, native Root, artifact generation/access/deletion isolation |
| HITL valid-input continuity | 80 checks PASS | [Log](final-hitl-vertical.log); separate checkpoint DB and processes |
| UNKNOWN human facts | 72 checks PASS | [Log](final-hitl-unknown.log); UNKNOWN remains unresolved; separate checkpoint DB |
| Real broker / reconnect | 3 PASS, 1 fixture-only SKIP | [Log](final-broker-real.log); the skipped backlog test passes through the dedicated 19-case suite |
| Native PostgreSQL reconnect | 1 PASS | [Log](final-postgres-reconnect.log); new connections, real thread lock, checkpoint/store continuity and scoped erasure |
| Semantic oracle / drain | 7 / 4 PASS | [Oracle](final-semantic-oracle.log), [drain](final-drain.log) |
| Source/static checks | PASS locally | API build/typecheck (`tsc --noEmit`), ESLint clean, check:business-logic-docs (975 conformant, 0 missing/invalid), test:business-logic-docs (5/5 PASS) |

Setup-only failed attempts (unstarted default test DB, overlapping resettable fixture names and an obsolete fixture assertion against the deliberately cleared success resume pointer) were corrected without weakening product assertions. The completed checkpoint ancestry is verified against persisted native checkpoint rows. No fixture is claimed to prove paid-provider semantics or production faults.

Exact-head CodeQL on `1094527d4` found an HTTP model-fixture Assessment ID flowing into a release-marker path. The first directory guard in `90b1f10c9` did not remove that HTTP dataflow; its scan correctly remained failed. The adapter now selects a preconstructed release marker from known fixture identities instead of composing a path from HTTP content. Input is also restricted to an owned temporary directory and `input.json`; traversal/unowned-path controls pass with 32 focused lifecycle tests. The security check must pass on the corrected follow-up HEAD; no alert is dismissed or waived. Production runtime sources remain identical to `1094527d4`.

## F. Production scope and safe envelope

Do not force two Roots onto Fogewise. [Fresh read-only preflight](final-rollout-preflight.json) observes deployed `2cd94a65e`, 4,745,097,216 free disk bytes (4.42 GiB), healthy API/runtime and terminal persisted native transports. The API login is correctly denied unrelated native checkpoint-table reads; canonical checkpoint DB latency is measured separately. Current changes affect admission/fencing, so exact-head CI, safe activation and one minimal native canary remain mandatory. Unrelated external services are outside process-control authority.

## G. Native concurrency and adaptive behavior

[November 2 native proof](acceptance4-native-proof.json), [summary](acceptance4-live-summary.json) and [source parity](acceptance4-source-parity.json) prove 1→2→1, two APIs/two bridges/one server, peak two, overlaps 48.479/62.330 seconds, independent checkpoints and three distinct pinned repository targets. [Provider-free 1/2/4/8 matrix](acceptance3-native-load-artifact.json) remains separate. Repeat only scenarios affected by new source changes; do not rerun a paid batch for presentation.

## H. Continuity, HITL, faults and checkpoint integrity

Real C Stop while D progresses, canonical Continue with 94 checkpoint parent links, HITL physical release and quiescent duplicate settlement remain historical live-provider proof. [New active fault receipt](final-active-faults.json) proves bridge SIGTERM remains draining while actual work runs, abrupt broker redelivery, two-owner short/queued progress while a long Root lives, API failover, live lease expiry retaining occupancy, server death with a separate external fixture HTTP request still alive, stale heartbeat/late finish/claim/quiescence denial, refusal of automatic uncertain model replay, lost receipt reconciliation, queued progress and audited same-thread descendant-checkpoint recovery. This is explicit conservative recovery, not a claim of exactly-once external calls after an upstream unknown response. Lease TTL is never proof of executor death.

The eight actual Fogewise human requests stay OPEN with the exact `doesNotKnow=true` disposition and unchanged facts/pins/checkpoints. Their factual completion is outside this ticket; capacity release and valid-input resume remain mandatory and are tested with isolated labeled fixtures.

## I. Provider, billing and resource governance

Retain real metrics, UNKNOWNs, all headroom and provider admission. Existing known reference amounts are $0.12957172 (production) and $0.13479441 (isolated), not invoices. Failed/unavailable attempts remain UNKNOWN. Validate invocation uniqueness, journal attribution, cache/input/output algebra, no replay-induced extra model calls/debits, and budget/rate refusal. Historical provider invoices are an external billing limitation, not an admission prerequisite. Both prior environment-specific test grants are reversed; do not regrant for provider-free tests.

## J. Receipts, rollback and recovery

Keep historical screenshots and derived charts dated and scoped. [October 31 production report](acceptance-20261031.md) and [November 2 native report](acceptance-20261102.md) remain immutable history. Audited adaptive disable + bounded policy + graceful drain is the primary supported rollback. Document legacy-binary incompatibility, safe refusal, interrupted-deployment detection and forward recovery without removing the fence. Any new operational change needs a revision-bound receipt.

## K. Acceptance Scope Reconciliation — Original BLOCKED → Final Disposition

The owner explicitly approved the replacements/out-of-scope decisions in the current FINAL EXECUTION PROMPT, sections 2.1–2.6. This is recorded scope agreement, not a passing test. Jira's original checklist is retained unchanged. Independent review remains mandatory; no safety invariant is removed.

| Original gate / objective | Original reason / current evidence | Classification | Actual work / technical justification | Residual risk | Final verification requirement / source | Blocks | Final status / responsible owner |
|---|---|---|---|---|---|---|---|
| Complete eight A2/B human requests | Legitimate unknown answers; 8 OPEN, no added fact | OUT_OF_SCOPE | Owner-approved exclusion; preserve exact human state, never fabricate facts | Those Assessments remain unfinished | [Unknown receipt](acceptance4-human-unknown.json); verify unchanged during rollout | Neither | OUT_OF_SCOPE_APPROVED / factual Assessment owners |
| Complete every live canary's legal/report workflow | Real canaries wait for legitimate operational input | REPLACE_WITH_EQUIVALENT_TEST | 149 completed-fixture checks and semantic oracle PASS; report generation/storage/access and negative controls retained | Synthetic fixture is not a real completed production Assessment | [Vertical log](final-legal-report-vertical.log), [oracle](final-semantic-oracle.log), full API/Python suites | Neither for tested non-regression | PASS_WITH_DEFINED_SCOPE / LCSP-364 engineer; unrelated defects to legal workstream |
| Actual provider invoice and historical failed-call usage closure | Reference sums known; 3 failed costs UNKNOWN across two environments | EXTERNAL_DEPENDENCY | Owner-approved separation from Root admission; preserve UNKNOWN and existing hold handling | Incomplete actual financial total | Keep invoice UNKNOWN; software accounting tests mandatory separately | Neither for invoice | EXTERNAL_DEPENDENCY / provider and billing owner |
| Software monetary/admission conservation | Historical real usage plus current kernel/API/Python regressions | REQUIRED | Kernel grant/reversal conservation, atomic paid admission and UNKNOWN/cache/failure handling PASS; automatic uncertain replay refused | An explicit operator retry can incur a new external charge; upstream UNKNOWN remains UNKNOWN | [8-case kernel/role log](final-isolation-green.log), full suites, [active refusal](final-active-faults.json); minimal production receipt still required after changes | New production enablement pending | PASS_WITH_DEFINED_SCOPE locally / LCSP-364 engineer |
| Two simultaneous Roots on Fogewise | Measured RAM refused second Root; actual production peak one | ENVIRONMENT_CONSTRAINT | Owner-approved representative environment; one under pressure is correct production behavior | Fogewise supports only measured envelope | Reuse [real native proof](acceptance4-native-proof.json); retain production guards | Neither if supported envelope passes | PASS_WITH_DEFINED_SCOPE / infrastructure owner |
| Repeated large paid load batch | 1/2/4/8 fixture matrix plus actual live-provider two-Root overlaps already accepted | ALREADY_PROVEN | No new payment solely for more screenshots/counts | Any source change invalidates only affected proof | [Native load receipt](acceptance3-native-load-artifact.json), [live summary](acceptance4-live-summary.json); rerun affected fixture tests | Neither absent affected change | PASS_WITH_DEFINED_SCOPE / LCSP-364 engineer |
| Active-execution failure & atomic operator recovery | Previously non-atomic replay & quiescent-only proof | REQUIRED | 10 active process scenarios PASS; single-transaction atomic DLQ replay/discard boundary verified with 13/13 real PostgreSQL concurrency tests (outbox-dlq-atomic-replay.e2e-spec.ts); audit failure rollback, admission reset, discard quiescence guard (`dlqDiscardUnsafeTarget` / `dlqDiscardDenied`), and disposable test database isolation verified | Controlled fail-closed recovery requires reconciliation of uncertain upstream effects | [Fault receipt](final-active-faults.json), [DLQ E2E Suite](apps/api/test/outbox-dlq-atomic-replay.e2e-spec.ts), [runbook](../../docs/runbooks/assessment-root-capacity.md#unclean-active-execution-recovery) | Neither for tested supported topology | PASS_WITH_DEFINED_SCOPE / operator owns explicit recovery |
| Enrollment ownership cannot be removed | Confirmed deployed app DML gap | REQUIRED | Additive immutable trigger; actual-role 8/8 regression PASS, existing rows untouched | SQL owner/superuser DDL is trusted; production migration not yet activated | [GREEN](final-isolation-green.log), [migration](../../apps/api/prisma/migrations/20261102043000_assessment_execution_isolation_immutable/migration.sql); deploy/verify current enrollments | Production enablement until migration verified | BLOCKED_REQUIRED deployment / LCSP-364 engineer |
| Global ownership of every external legacy writer | Scoped fence accepted, unprotected legacy paths not enrolled | REQUIRED | Permit only explicitly supported scoped execution until all writers enforce admission or are excluded | Unsupported legacy work is outside global-cap claim | Prove owned route and immutable enrollment; document fail-closed global enablement restriction | Global enablement; scoped merge only after hardening | BLOCKED_REQUIRED / LCSP-364 engineer, deployment operator |
| Full production multi-tenant paid fairness campaign | Real paid cohort uses one customer | REPLACE_WITH_EQUIVALENT_TEST | 19 PG/MQ cases and active two-owner long/short/queued fault scenario PASS, out-of-order and Continue use canonical intent | Fairness applies to independent eligible commands, not semantic completion | [Admission log](final-capacity-integration.log), [two-owner native fault](final-active-faults.json); 1/2/4/8 matrix rerun below | Neither after fixture matrix PASS | PASS_WITH_DEFINED_SCOPE / LCSP-364 engineer |
| Post-human-answer legal continuation | Real answers unavailable | REPLACE_WITH_EQUIVALENT_TEST | 80 valid-input HITL checks and 72 unknown-fact checks PASS with separate native checkpoint DB/processes | Does not complete real customer Assessment | [Valid input](final-hitl-vertical.log), [UNKNOWN](final-hitl-unknown.log) | Neither | PASS_WITH_DEFINED_SCOPE / factual Assessment owners retain live requests |
| Legacy binary rollback while protected work unfinished | OWNED_PENDING/immutable authority incompatible with old publishers | REPLACE_WITH_EQUIVALENT_TEST | Owner-approved bounded-policy disable/drain as primary rollback; unsafe old binary must refuse | Old binary cannot own unfinished protected work | Test/document compatibility predicate, refused downgrade, forward recovery and interrupted deployment | Merge and enablement until contract verified | BLOCKED_REQUIRED / LCSP-364 engineer, deployment operator |
| Exact deployment and first activation | 2cd94a65e production native evidence, 140 migrations, rollback preserved | ALREADY_PROVEN | Reuse unchanged source; any admission/fencing change needs exact-head rollout/minimal canary | Current required hardening may invalidate affected evidence | [Production report](acceptance-20261031.md), [fresh preflight](final-baseline-production.json); conditional new rollout | Enablement after affected change | PASS_WITH_DEFINED_SCOPE currently; new change conditional / SRE |
| Native overlap, simultaneous Stop, third waiting | Reviewer accepted 48.479/62.330 s, C Stop while D progresses, E waits/progresses | ALREADY_PROVEN | Do not require Fogewise >1 or replay paid work without changed behavior | Supported one-server topology only | [Native proof](acceptance4-native-proof.json), [Stop proof](acceptance4-stopped-while-d-active.json) | Neither absent affected source change | PASS_WITH_DEFINED_SCOPE / LCSP-364 engineer |
| Independent code/release approval | Current CHANGES_REQUESTED; prior P1s explicitly resolved by reviewer | EXTERNAL_DEPENDENCY | Preserve review and branch protection; request new disposition on completed changes | No agent self-approval or automatic dismissal | Fresh authorized independent review on final HEAD; inspect protection / merge eligibility | Merge and release | EXTERNAL_DEPENDENCY / independent reviewer, repository maintainer |

Final engineering/release decision will be updated only from completed verification. Exact-head CI and affected production deployment/canary remain required; independent approval remains external. Legitimate human unknowns, invoice availability and Fogewise's inability to host two Roots are not required blockers.
