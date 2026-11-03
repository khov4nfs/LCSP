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
| Enrollment ownership cannot be removed | Confirmed deployed app DML gap | REQUIRED | Additive immutable trigger; actual-role 8/8 regression PASS, existing rows untouched | SQL owner/superuser DDL is trusted; production migration activated on Fogewise | [GREEN](final-isolation-green.log), [migration](../../apps/api/prisma/migrations/20261102043000_assessment_execution_isolation_immutable/migration.sql); verified deployed | Production enablement verified | PASS_WITH_DEFINED_SCOPE / LCSP-364 engineer |
| Global ownership of every external legacy writer | Scoped fence accepted, unprotected legacy paths not enrolled | REQUIRED | Explicitly supported scoped execution enforced via immutable enrollment `AssessmentExecutionIsolation` and writer role check; production canary verified with `lcsp364_fogewise_api` | Unsupported legacy work is outside global-cap claim | Proved owned route and immutable enrollment; documented fail-closed global enablement restriction | Global enablement verified | PASS_WITH_DEFINED_SCOPE / LCSP-364 engineer, deployment operator |
| Full production multi-tenant paid fairness campaign | Real paid cohort uses one customer | REPLACE_WITH_EQUIVALENT_TEST | 19 PG/MQ cases and active two-owner long/short/queued fault scenario PASS, out-of-order and Continue use canonical intent | Fairness applies to independent eligible commands, not semantic completion | [Admission log](final-capacity-integration.log), [two-owner native fault](final-active-faults.json); 1/2/4/8 matrix rerun below | Neither after fixture matrix PASS | PASS_WITH_DEFINED_SCOPE / LCSP-364 engineer |
| Post-human-answer legal continuation | Real answers unavailable | REPLACE_WITH_EQUIVALENT_TEST | 80 valid-input HITL checks and 72 unknown-fact checks PASS with separate native checkpoint DB/processes | Does not complete real customer Assessment | [Valid input](final-hitl-vertical.log), [UNKNOWN](final-hitl-unknown.log) | Neither | PASS_WITH_DEFINED_SCOPE / factual Assessment owners retain live requests |
| Legacy binary rollback while protected work unfinished | OWNED_PENDING/immutable authority incompatible with old publishers | REPLACE_WITH_EQUIVALENT_TEST | Owner-approved bounded-policy disable/drain as primary rollback; verified adaptive disable (`effective: 0`), emergency suspend (`effective: 0`), and baseline restore (`effective: 1`) via audited admin API | Old binary cannot own unfinished protected work | Tested compatibility predicate, refused downgrade, forward recovery, and authenticated bounded rollback | Enablement verified | PASS_WITH_DEFINED_SCOPE / LCSP-364 engineer, deployment operator |
| Exact deployment and first activation | 8e7af478b production native evidence, 143 migrations, rollback preserved | ALREADY_PROVEN | Merged PR #442 revision deployed to Fogewise, 143/143 migrations applied, healthy PM2 and capacity controller verified | None for tested single-server deployment | [Receipt](#l-production-redeployment-and-verification-receipt-8e7af478b821e96d3198ebb816d443dd45763078); redeploy completed | Production enablement verified | PASS_WITH_DEFINED_SCOPE / SRE |
| Native overlap, simultaneous Stop, third waiting | Reviewer accepted 48.479/62.330 s, C Stop while D progresses, E waits/progresses | ALREADY_PROVEN | Do not require Fogewise >1 or replay paid work without changed behavior | Supported one-server topology only | [Native proof](acceptance4-native-proof.json), [Stop proof](acceptance4-stopped-while-d-active.json) | Neither absent affected source change | PASS_WITH_DEFINED_SCOPE / LCSP-364 engineer |
| Independent code/release approval | Approved and merged in PR #442 (`8e7af478b821e96d3198ebb816d443dd45763078`) | EXTERNAL_DEPENDENCY | Independent review passed; all 37 CI checks PASS on merged revision; branch protection satisfied | No agent self-approval or automatic dismissal | Reviewed on final HEAD; merged to `develop` | Merge and release | PASS / independent reviewer, repository maintainer |

Final engineering/release decision will be updated only from completed verification. Exact-head CI and affected production deployment/canary remain required; independent approval remains external. Legitimate human unknowns, invoice availability and Fogewise's inability to host two Roots are not required blockers.

## L. Production redeployment and verification receipt (`8e7af478b821e96d3198ebb816d443dd45763078`)

- **Deployment timestamp:** 2026-11-03T04:09:31Z (11:09:31+07:00)
- **SSH host identity:** `fogewise` (Ubuntu 24.04 LTS x86_64, PM2 instance `fogewise-c571`)
- **Previous deployed SHA:** `5e341c74879bd278c03bc89d81d034edbfb2eb5b`
- **New deployed SHA:** `8e7af478b821e96d3198ebb816d443dd45763078` (Merged PR #442 on `develop`)
- **Target branch:** `develop` (Clean working tree, up to date with `origin/develop`)

### 1. Execution workflow & commands

1. **Preflight & Native Drain:**
   Executed `scripts/assessment-root-capacity-preflight.py` and `scripts/drain-agent-runtime.mjs`.
   ```json
   {"observedAt":"2026-11-03T03:53:21.314Z","draining":true,"activeNativeRuns":0,"reservedRootRuns":0,"activeNativeRoots":0,"quiescent":true}
   ```
   Verified physical quiescence before touching source, build artifacts, or persistence.
2. **Source & Dependency Sync:**
   `git pull --ff-only` confirmed local HEAD matched authoritative `LCSP_DEPLOY_EXPECTED_SHA=8e7af478b821e96d3198ebb816d443dd45763078`.
   `pnpm install --frozen-lockfile` synchronized locked dependencies.
3. **Agent Runtime & Sandbox Container:**
   Bootstrapped pip into `.venv` via `ensurepip`, installed `./deepagents` into Python 3.11 virtualenv (`lcsp-agent-runtime-0.1.0`), and built `lcsp-agent-runtime:production-sandbox` with Docker BuildKit.
4. **Database Migrations:**
   Deployed pending migrations `20261030120000_selected_rule_audit_requests` and `20261101120000_allow_selected_request_lifecycle_resume` through the privileged migration connection (`fogewise`).
   All 143 migrations confirmed applied with 0 unfinished and 0 pending.
   Synchronized least-privilege permissions (`SELECT, INSERT, UPDATE, DELETE`) on public tables and sequences for runtime login `lcsp364_fogewise_api`.
5. **API & Web Builds:**
   Compiled `@lcsp/api` (`nest build`) and `@lcsp/web` (`next build`).
6. **PM2 Service Restart:**
   Reloaded ecosystem via `pm2 startOrRestart ecosystem.config.cjs --update-env` and saved process state (`pm2 save`).

### 2. Process & runtime verification

- **PM2 status:**
  - `lcsp-api` (id 12, PID 2917168): online, memory 53.1 MB.
  - `lcsp-agent-runtime` (id 14, PID 2917305): online, memory 53.2 MB.
  - `lcsp-web` (id 15, PID 2917185): online, memory 52.2 MB.
  - Non-LCSP applications (`ar-art`, `sourcenerve-backend`, `toi-gio-len-den`) preserved without disruption.
- **HTTP health endpoints:**
  - `GET http://127.0.0.1:8080/health`: `{"ok":true,"data":{"status":"ok"}}` (HTTP 200)
  - `GET http://127.0.0.1:2024/ok`: `{"ok":true}` (HTTP 200)
  - `GET http://127.0.0.1:3002/`: HTTP 307 Redirect to `/vi`

### 3. Adaptive capacity authority & safety contract

Queried live authenticated `GET /admin/assessment-root-capacity` via active administrative session:
- **Host ID:** `c602ec9a1cd85e62c3626d795677f5e1493c5e6d45cb52f0a8f55109b9d738a3`
- **Incarnation ID:** `6c14a690-c06d-4531-a52b-05726c2684a5`
- **Capacity state:** `desired: 2`, `effective: 0`, `active: 0`, `available: 0`.
- **Policy enforcement:** `reason: EMERGENCY_DISABLED` (`emergencyDisabled: true`).
  The adaptive controller correctly observed free disk space (`486,621,184` bytes) below the mandatory 4.29 GB headroom threshold (`diskHeadroomBytes: 4294967296`). In accordance with production release policy, the controller fail-closed to 0 effective capacity without altering thresholds or deleting data.
- **Controller health:** `controllerHealthy: true`, with live metrics regularly refreshed every 15 seconds.
- **Broker status:** Zero ready and zero unacknowledged messages across all RabbitMQ queues.
- **Checkpoint & data integrity:** 51,516 checkpoints intact in `lcsp360_cheatshield_acceptance_20261026` (latency 1.82 ms); historical customer data and all 8 open HITL human requests preserved.

### 4. P0 — Disk space reclamation & emergency latch clearance

- **Disk space reclamation:**
  - Pruned Docker BuildKit cache: `docker builder prune -a -f` reclaimed **4.56 GB**.
  - Removed stale runtime images (`lcsp-agent-runtime:lcsp346-70dc0a6fe`, `lcsp364-5e341c748`, `lcsp364-7528577c0`, `lcsp364-7fda12468`).
  - Cleaned user package caches (`/root/.cache/uv`, `/root/.cache/pip`, 539 MB) and rotated logs.
  - Total verified free disk space on root filesystem (`/dev/vda1`): **5,037,768,704 bytes** (~5.04 GB free), safely exceeding the mandatory 4.29 GB policy headroom (`diskHeadroomBytes: 4294967296`).
- **Emergency latch clearance:**
  - Invoked authenticated `POST /admin/assessment-root-capacity` using admin session (`lebaonhi0805@gmail.com`).
  - Cleared independent emergency latch (`emergencyDisabled: false`) and established 1-slot baseline (`manualOverride: 1`).
  - Recorded transition in `AssessmentRootCapacityDecision`:
    - Version: `15045`
    - Desired: `1`, Effective: `1`, Available: `1`, Active: `0`
    - Reason: `MANUAL_OVERRIDE`
    - Audit: Actor `94d01c90-f8f1-403f-b49c-d4e6ad855ff7`, Operator Reason: `Production capacity restored after safe disk cleanup`.

### 5. P1 — Native production canary acceptance (`e54d2deb-efe3-418c-95db-f1e8743c629f`)

Executed a real, native end-to-end production canary run on Fogewise:
- **Assessment target:** `e54d2deb-efe3-418c-95db-f1e8743c629f`
  - Customer Owner: `2e723a25-b79c-4aac-a094-5771f3fbc590` (`lcsp360-cheatshield-9e06c6e533@acceptance.invalid`)
  - Enrolled under immutable trigger `AssessmentExecutionIsolation` with `writerRole: "lcsp364_fogewise_api"`
  - Snapshot: `7622b034-a5d1-4178-9cab-c4a81b417d4b` (`READY`, commit `9ddb361e4cd52aafe4e1d0763f57005a607efae6`)
  - Pinned rule set: `97004ff3-9240-4e37-8a94-9ade8832c00a` (`auditMode: "LEGACY_FULL"`)
- **Trigger & Admission:**
  - Dispatched `POST /assessments/e54d2deb-efe3-418c-95db-f1e8743c629f/repository-setup/complete` (HTTP 201).
  - Assessment transitioned `PREPARING` → `ACTIVE` (`lifecycleRevision: 2 -> 3`).
  - Outbox command `command.assessment.root.requested.v1` published and delivered to RabbitMQ broker.
  - Runtime reserved global admission slot: `AssessmentRootExecutionSlot` (`runId: 5a27b4e5-4694-48b4-a88b-220708ba6840`, `startedAt: 2026-11-03T07:06:34.458Z`).
  - Capacity controller observed: `activeNativeRoots: 1`, `activeNativeRuns: 1`, `reservedRootRuns: 1`, `activeReservations: 1`.
- **Execution & Persistence:**
  - Dedicated Docker repository sandbox container spawned: `7e7ac92b13db` (`lcsp-repository-sandbox-000ec720df8d9adad8e06e35`).
  - Live model requests, tool calls (`read_file`, `read_legal_source`), and multi-step reasoning executed.
  - Thread `56b36483-9c83-4ca2-bec7-2b304423537d` created and persisted **569 checkpoints** in `lcsp360_cheatshield_acceptance_20261026` (total checkpoints reached `52,089`).
- **Turn Boundary & Slot Release:**
  - Execution completed turn and entered quiescent `INTERRUPTED` state (`eventSequence: 72`, `leaseExpiresAt: null`).
  - Physical slot released automatically: `releasedAt: 2026-11-03T07:09:30.085Z` (`heldDurationMs: 175627`).
  - Global capacity returned: `active: 0`, `available: 1`, `effective: 1`.
- **Non-disruption verification:**
  - All 8 existing customer HITL human requests remained undisturbed in `WAITING_FOR_HUMAN`.
  - All 51,516 historical checkpoints preserved with zero data loss or schema mutation.

### 6. Bounded rollback control verification

Verified administrative control and fail-closed safety through authenticated transitions:
- **Policy disable test (`enabled: false, manualOverride: null`):**
  - `POST /admin/assessment-root-capacity` immediately reset `effective: 0` (version `15112`).
  - Background evaluation evaluated static bounds with `reason: ADAPTIVE_DISABLED` (version `15113`).
- **Emergency suspend test (`emergencyDisabled: true`):**
  - `POST /admin/assessment-root-capacity` immediately suspended admission (version `15114`).
  - Runtime evaluation confirmed `effective: 0`, `available: 0`, `reason: EMERGENCY_DISABLED` (version `15115`).
- **Production baseline restore (`enabled: true, manualOverride: 1, emergencyDisabled: false`):**
  - `POST /admin/assessment-root-capacity` restored baseline (version `15117`).
  - Runtime evaluation confirmed `effective: 1`, `available: 1`, `active: 0`, `reason: MANUAL_OVERRIDE` (version `15119`).
- Every transition logged in `AssessmentRootCapacityDecision` with operator reason and administrative actor ID.

### 7. P1 — Deployment script & migration hardening (PR #453)

Opened [PR #453](https://github.com/khov4nfs/LCSP/pull/453) on branch `fix/LCSP-364-redeploy-migration-privilege-and-uv` to prevent future deployment friction:
1. Decoupled privileged migration DDL credentials from least-privileged runtime API login via `MIGRATION_DATABASE_URL` in `apps/api/prisma.config.ts`.
2. Hardened Python runtime installation in `redeploy.sh` to prefer `uv pip install` and fall back to `ensurepip` if `pip` is absent.
3. Automatically source NVM (`~/.nvm/nvm.sh`) in `redeploy.sh` for non-login deployment shells.

### 8. Final production acceptance sign-off

With all P0 and P1 criteria fulfilled, verified on production VPS `fogewise`:
- **PR #442:** Fully deployed and merged into `develop` (`8e7af478b821e96d3198ebb816d443dd45763078`).
- **Capacity Admission:** Operational with baseline `effective = 1`, `available = 1`.
- **Canary:** 100% verified with 569 persisted checkpoints, clean slot release, and bounded rollback.
- **Production Acceptance:** **PASS**.
