# LCSP-364 — Final acceptance (A–K)

Current decision: **BLOCKED REQUIRED** pending exact-head CI and affected production activation/canary. Independent review is also required. The local correctness gates below have passed; no merge, release approval or Jira Done is claimed.

## A. Exact baseline and source identity

Verified at the start of this completion pass: local/GitHub PR #442 HEAD `1260e3e00a1950ef0559f1e313aeed6132e10739`, OPEN, CHANGES_REQUESTED; 46 SUCCESS rollup contexts. The latest independent evidence review explicitly accepts the isolated real-provider two-Root proof. Fogewise is still `2cd94a65e26397a1bb486a6ba4de2c168d152192`, 140 applied migrations, healthy API, 4,799,131,648 free disk bytes and zero held physical slots. [Read-only baseline](final-baseline-production.json). SourceNerve workspace discovery currently returns -32603; GitHub/Jira and repository graph tools remain available. No claim is based solely on historical memory.

## B. Confirmed root causes and corrections

The original fixed executor design and both reviewed P1 corrections remain described in the historical reports. The reviewer accepted both P1 fixes on `7528577c0`: exact eligibility is separate from the 10,000-row fairness window, and `/runs/wait` is removed.

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
| Source/static checks | PASS locally | API build/typecheck/changed-file lint, contract/import/billing/retired-authority gates, five documentation-checker tests; exact-head CI remains separate |

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
| Active-execution failure/recovery | Previously only quiescent proof | REQUIRED | 10 real-process scenarios PASS; actual external fixture operation survives server death, no automatic model repeat; ADMIN denial/replay and ancestry verified | Controlled fail-closed recovery requires reconciliation of uncertain upstream effects | [Fault receipt](final-active-faults.json), [runbook](../../docs/runbooks/assessment-root-capacity.md#unclean-active-execution-recovery) | Neither for tested supported topology | PASS_WITH_DEFINED_SCOPE / operator owns explicit recovery |
| Enrollment ownership cannot be removed | Confirmed deployed app DML gap | REQUIRED | Additive immutable trigger; actual-role 8/8 regression PASS, existing rows untouched | SQL owner/superuser DDL is trusted; production migration not yet activated | [GREEN](final-isolation-green.log), [migration](../../apps/api/prisma/migrations/20261102043000_assessment_execution_isolation_immutable/migration.sql); deploy/verify current enrollments | Production enablement until migration verified | BLOCKED_REQUIRED deployment / LCSP-364 engineer |
| Global ownership of every external legacy writer | Scoped fence accepted, unprotected legacy paths not enrolled | REQUIRED | Permit only explicitly supported scoped execution until all writers enforce admission or are excluded | Unsupported legacy work is outside global-cap claim | Prove owned route and immutable enrollment; document fail-closed global enablement restriction | Global enablement; scoped merge only after hardening | BLOCKED_REQUIRED / LCSP-364 engineer, deployment operator |
| Full production multi-tenant paid fairness campaign | Real paid cohort uses one customer | REPLACE_WITH_EQUIVALENT_TEST | 19 PG/MQ cases and active two-owner long/short/queued fault scenario PASS, out-of-order and Continue use canonical intent | Fairness applies to independent eligible commands, not semantic completion | [Admission log](final-capacity-integration.log), [two-owner native fault](final-active-faults.json); 1/2/4/8 matrix rerun below | Neither after fixture matrix PASS | PASS_WITH_DEFINED_SCOPE / LCSP-364 engineer |
| Post-human-answer legal continuation | Real answers unavailable | REPLACE_WITH_EQUIVALENT_TEST | 80 valid-input HITL checks and 72 unknown-fact checks PASS with separate native checkpoint DB/processes | Does not complete real customer Assessment | [Valid input](final-hitl-vertical.log), [UNKNOWN](final-hitl-unknown.log) | Neither | PASS_WITH_DEFINED_SCOPE / factual Assessment owners retain live requests |
| Legacy binary rollback while protected work unfinished | OWNED_PENDING/immutable authority incompatible with old publishers | REPLACE_WITH_EQUIVALENT_TEST | Owner-approved bounded-policy disable/drain as primary rollback; unsafe old binary must refuse | Old binary cannot own unfinished protected work | Test/document compatibility predicate, refused downgrade, forward recovery and interrupted deployment | Merge and enablement until contract verified | BLOCKED_REQUIRED / LCSP-364 engineer, deployment operator |
| Exact deployment and first activation | 2cd94a65e production native evidence, 140 migrations, rollback preserved | ALREADY_PROVEN | Reuse unchanged source; any admission/fencing change needs exact-head rollout/minimal canary | Current required hardening may invalidate affected evidence | [Production report](acceptance-20261031.md), [fresh preflight](final-baseline-production.json); conditional new rollout | Enablement after affected change | PASS_WITH_DEFINED_SCOPE currently; new change conditional / SRE |
| Native overlap, simultaneous Stop, third waiting | Reviewer accepted 48.479/62.330 s, C Stop while D progresses, E waits/progresses | ALREADY_PROVEN | Do not require Fogewise >1 or replay paid work without changed behavior | Supported one-server topology only | [Native proof](acceptance4-native-proof.json), [Stop proof](acceptance4-stopped-while-d-active.json) | Neither absent affected source change | PASS_WITH_DEFINED_SCOPE / LCSP-364 engineer |
| Independent code/release approval | Current CHANGES_REQUESTED; prior P1s explicitly resolved by reviewer | EXTERNAL_DEPENDENCY | Preserve review and branch protection; request new disposition on completed changes | No agent self-approval or automatic dismissal | Fresh authorized independent review on final HEAD; inspect protection / merge eligibility | Merge and release | EXTERNAL_DEPENDENCY / independent reviewer, repository maintainer |

Final engineering/release decision will be updated only from completed verification. Exact-head CI and affected production deployment/canary remain required; independent approval remains external. Legitimate human unknowns, invoice availability and Fogewise's inability to host two Roots are not required blockers.
