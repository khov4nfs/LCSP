# LCSP-364 — isolated production acceptance, 2026-10-31

**Verdict: BLOCKED for complete production acceptance and merge.** Actual native execution, Stop/Continue, HITL release, automatic admission recovery, resource refusal, quiescent restart, stale-incarnation rejection, duplicate redelivery and bounded-mode rollback were observed. Both Assessments legitimately remain `WAITING_FOR_HUMAN`; no legal/report completion is claimed. Jira remains In Progress and the PR is not merged.

Runtime source and PR HEAD **at deployment and every native experiment**: **`2cd94a65e26397a1bb486a6ba4de2c168d152192`**. Subsequent publication changes evidence only. [Exact runtime-head CI](acceptance3-ci-2cd94a65e.json): 37/37 SUCCESS. Final evidence-publication HEAD checks are recorded on [PR #442](https://github.com/khov4nfs/LCSP/pull/442). No affected production proof is attributed to a different implementation.

## A. Baseline and implementation

GitHub and a fresh authenticated fetch confirm develop `aa2ce4f3f7c5b1b6375eaf659bee0197aa61803b`. This round started at PR `d68f748882f3999512276a4794defbc135b7b95f`, with Fogewise rolled back to `44dba336f332d566d3fee9fc0d32642a402d024e`. [Previous failed A and rollback](rollout-20261031.md) remain historical evidence.

One decision-owning Root/thread per Assessment, API/PostgreSQL leases, RabbitMQ delivery, native LangGraph checkpoints, legal/completion gates and paid admission remain authoritative. Researcher concurrency stays one. Physical topology remains **2 boundary workers / prefetch 2 / Agent Server slots 2**, with one authoritative Agent Server. Admission can be lower, including zero during safety holds.

## B. Root cause

**Original Canary A:** RUNNING/FAILED events reference a transport UUIDv7 absent from Fogewise's native store, with zero physical reservations. Upgraded claim requires a reservation before RUNNING, proving these writes bypassed the intended boundary. Shared-database outbox publishers can select pending work and publish into their own brokers. Original publisher identity and terminal exception were not durably captured and remain **UNKNOWN**; insufficient credit was never established as the cause. No external business investigation or process termination occurred.

**Fix:** enroll fresh canaries under the upgraded PostgreSQL login before dispatch. `OWNED_PENDING` hides their commands from legacy publishers; `session_user` triggers reject foreign-login writes to protected canonical rows. The actual old-login UPDATE returned SQLSTATE 42501. New native transports now match Fogewise physical reservations and API ownership.

**Additional defect:** failed original A retained ACTIVE lifecycle plus an uncompleted, unbound demand despite a COMPLETED Root turn. It could permanently lead fairness with an empty broker. Eligibility now excludes a matching FAILED/SUCCEEDED completed turn's strictly older command. It preserves history, held physical slots and same-millisecond new continuations. Real PostgreSQL RED on the prior implementation preceded GREEN.

Both reviewed P1s were already corrected: valid commands beyond the 10,000-row fairness window defer instead of becoming obsolete, and synchronous `/runs/wait` returns 405 instead of bypassing bounded execution. Their PostgreSQL/RabbitMQ and concurrent route/drain regressions remain review evidence.

## C. Architecture

[ADR](../../docs/adr/LCSP-364-adaptive-root-admission.md) and [runbook](../../docs/runbooks/assessment-root-capacity.md) describe row-locked global admission, versioned reports, physical reservations, incarnation fencing, owner rotation and conservative telemetry. Lease expiry never frees execution still capable of writing. Fixed physical executor ceilings avoid unbounded local queues; effective admission changes automatically without mutating executor internals.

Agent Server horizontal replicas are not enabled. Actual fenced replacement proved read-only recovery of both exact checkpoints from the existing durable store/checkpointer. Two bridge connections share one server in the real native CI matrix.

Opt-in `AssessmentExecutionIsolation` protects new, unstarted canaries against accidental legacy application writers, including SET ROLE impersonation; it is not protection against a malicious superuser changing the fence itself. The external instance remains untouched. **Scoped canary isolation does not prove every legacy production execution participates in global admission.**

## D. Changes and commits

- `7528577c0`: reviewed fairness-window and synchronous-route P1 fixes.
- `585828b05467257b23bfa6b6a08ccd1825ca6842`: DB-login isolation, owned outbox contracts/mappers, public compiled operations export, exact-account grant/reversal/enrollment, real kernel/roles/RabbitMQ tests, CI/runbook.
- `7fda124687ea22cea4ae8fa14f684098b9338efc`: Web OWNED_PENDING expectation and funding/evidence receipts.
- `2cd94a65e26397a1bb486a6ba4de2c168d152192`: terminal-demand correction and held-slot/same-millisecond regressions.

No historical Assessment, accepted decision, checkpoint, report or usage record was rewritten to support scheduling.

## E. Automated tests

| Check | Actual result and scope |
|---|---|
| Accounting/isolation acceptance | 7 PASS: real PostgreSQL roles, existing BillingAccountingKernel, atomic audit/idempotency/reversal and confirmed RabbitMQ backoff/redelivery; zero provider calls |
| Current distributed admission | 19 PASS plus real SDK/RabbitMQ 10,001-command child, including terminal-demand and held-slot regressions |
| Policy/outbox | 98 PASS, pressure, stale/missing measurements, hysteresis/cooldown, override and fairness |
| Broad local API | 187 suites / 1,561 tests PASS; 15 suites / 146 tests skipped, before the final two focused additions |
| Web | 345 tests PASS after OWNED_PENDING fixture correction; acceptance2-web.log |
| Source gates | Documentation checker: 0 missing/invalid, 5 checker tests PASS; contracts/imports, lint, schema/builds PASS, no baseline expansion |
| Exact deployed-head CI | **37/37 SUCCESS**, including PostgreSQL/RabbitMQ, native vertical, Docker and browser/release jobs |

Local logs are `acceptance2-*.log`; skips are not PASS. [Artifact receipt](acceptance3-native-load-artifact.json) binds the exact-head native matrix to GitHub run [41184224299](https://github.com/khov4nfs/LCSP/actions/runs/41184224299), artifact 13036512669 and verified archive SHA-256.

## F. Production deployment

The 7fda activation first proved migration/isolation without paid canary execution. Corrective 2cd94a65e then passed scoped quiescence, authenticated drain, frozen builds and LCSP-only PM2 activation.

| Identity | Captured value |
|---|---|
| Previous source | `7fda124687ea22cea4ae8fa14f684098b9338efc`; preserved older rollback target `44dba336f332d566d3fee9fc0d32642a402d024e` |
| Runtime source | `2cd94a65e26397a1bb486a6ba4de2c168d152192`, clean `/srv/apps/LCSP` |
| Activation completed | `2026-10-31T08:47:56.266463+00:00` |
| Runtime/sandbox image identity | `sha256:dbdcb42c039f99a2343de952c7cc7b73f106766eb0199811f64738cf66bb2160`, OCI revision 2cd94a65e |
| Web BUILD_ID | `JkRQ7uuBPfMZ4IpXwiwqc`, verified in actual public browser HTML |
| Environment fingerprint | `fd98df1b7cc562d5f9884cdd7ebd36495a4cc574da7b9468b5bff308d099b471`, unchanged in this activation/restart |
| Migrations | 140 completed, zero unfinished, all source checksums match; no new migration in 2cd94a65e |
| Health/mode | API/Web/native 200; actual native process production mode, no active LCSP_TEST flags |

The native PM2 server/bridge use the built host environment; the image identifies the prepared repository runtime image, not a claim the PM2 server runs in Docker. [Build](acceptance3-build-receipt.json) and [activation](acceptance3-activation-receipt.json) retain identities and individual step results. The activation's configuration-key list describes retained rollout settings; its before/after fingerprint is unchanged.

Only the superseded 752 generated candidate build was removed after complete verified off-host archival, reclaiming 434,495,488 bytes. Live builds, sandboxes, databases, important rollback material and unrelated services were retained. Every build step/activation exceeded the 4 GiB disk policy. No broad prune or database reset occurred.

## G. Actual load and concurrency evidence

| Canary | Assessment | Exact public repository commit |
|---|---|---|
| A2 | `b19a1fc4-1c69-4009-804a-ad7cfa5d512d` | shreeram312/AI-Proctored-System @ `9ddb361e4cd52aafe4e1d0763f57005a607efae6` |
| B | `719a1e49-4fb0-4c30-a2b6-46bea28874b0` | Kowshik-18/credit_score_engine @ `132b5d796b32bf2f4454990b64df7d0435e28161` |

B retains its original 752-labelled creation name; execution identity comes from receipts. A2 is fresh; original failed A was preserved.

| Native segment | Physical admission UTC | Native start UTC | Physical release UTC | Outcome |
|---|---|---|---|---|
| A2 initial `70f9547f…` | 08:52:00.224 | 08:52:00.427 | 08:53:33.611 | Supported Stop |
| B initial `5adb9f26…` | 08:53:40.732 | 08:53:40.836 | 08:56:43.906 | HITL, quiescent |
| A2 Continue `30d011c7…` | 08:58:10.970 | 08:58:11.089 | 08:59:32.204 | Same Root lineage; HITL |

SQL span peak and measured native/admitted peaks were **one**. B waited while A2 occupied the safe slot and entered 7.225 seconds after release. Continue was requested after B reached HITL; it waited for adaptive recovery, rather than overlapping B. Three-segment enqueue-to-native-start p50/p95: **45.412 / 59.830 s**. This small diagnostic sample is not an SLA or completed-Assessment throughput; neither Assessment finished legal/report processing.

Actual automatic `BACKLOG_HEADROOM` changed effective capacity **0 → 1** before A2 Continue started. No operator set that admission to one. Subsequent low-demand decisions were captured. A later audited emergency hold reduced admission to zero without terminating work. Final bounded policy requests two, but memory keeps effective admission at one (`MEMORY_PRESSURE`); low CPU never justified expansion.

[Timeline](acceptance3-capacity-timeline.jsonl): 279 measurements plus one unavailable observer sample during restart. [Summary](acceptance3-production-summary.json), [physical receipts](acceptance3-native-quiescent.json) and [capacity chart](acceptance3-capacity-derived.png) distinguish queued/admitted/actual Roots, desired/effective capacity, resources and decisions. The chart is **derived from captured measurements, not a live screenshot**.

The separate exact-head **provider-free native** matrix uses two bridges, one server, real API/PG/RabbitMQ/checkpoints and scripted model/local repository, with a three-slot physical ceiling and larger measured memory envelope:

| Submitted | Completed fixture Assessments | Actual peak | Queue p50 / p95 ms | Elapsed s | Fixture completions/min |
|---|---|---|---|---|---|
| 1 | 1 | 1 | 15132.337 / 15132.337 | 42.616 | 1.408 |
| 2 | 2 | 2 | 7648.893 / 14381.343 | 42.622 | 2.815 |
| 4 | 4 | 3 | 22663.828 / 30310.478 | 57.672 | 4.161 |
| 8 | 8 | 3 | 37753.454 / 70168.054 | 102.611 | 4.678 |

[Raw matrix](acceptance3-native-load-ci.json) explicitly retains no paid accounting, no Docker sandbox workload and synthetic fixture pins. It does not prove production concurrency three. Production submitted two targets and executed three segments; no paid eight-target batch was run.

## H. Stop/Continue, HITL and isolation

A2 retains thread `1f039d1f-8daa-4cd1-a6e8-02938f3e3b98` and logical execution `6f869774-db6d-4465-be46-87ebd34f682c`. Continue uses a new physical transport, not another decision-owning Root. Resumed checkpoint `1f1d5096-232a-6f04-8261-6f728b7b651a` descends from stopped checkpoint `1f1d5088-d5e8-632b-819a-be9c251f1276` on the same canonical thread/namespace. [Stored parent-chain proof](acceptance3-checkpoint-lineage.json) is actual database evidence.

B owns thread `619454fb-1ebc-44bc-aaa3-fcfef52ff0bc`, checkpoint `1f1d508f-eab1-67b5-820d-95ef69f78247`. Both are WAITING_FOR_HUMAN, execution interrupted, zero held physical slots. A COMPLETED runtime turn means that execution segment quiesced, not legal completion.

[Provenance](acceptance3-pins-provenance.json) records independent snapshots, unchanged Rule Set/legal corpus pins, evidence/fact counts and zero accepted decisions. No operator, jurisdiction or deployment fact was invented. Actual test CUSTOMER cross-account events/provenance returned 404; operator control read returned 403. [Denial receipt](acceptance3-access-denial.json) exposes no foreign content.

Simultaneous Stop A while B runs, two paid overlapping Roots, a third concurrently waiting paid target and post-HITL answer continuation were not performed within the one-slot memory envelope. Their automated coverage remains distinct; these production scenarios remain BLOCKED.

## I. Resources, provider and monetary governance

Measured available memory: **4,232,679,424–5,675,110,400 bytes**; free disk: **4,938,088,448–4,979,380,224 bytes**. Aggregate sandbox memory peaked at **469,458,288.64 sampled bytes**, sandbox CPU at **1.0544 cores**, DB connections at **25/100**, checkpoint latency **1.551–68.715 ms**, CPU/disk pressure about **3.11%/3.10%**. Persistent sandbox count was three to five. Docker-formatted samples are approximations; shared Python RSS cannot be assigned exactly per Root and is not guessed.

Final capture: about **4.99 GiB memory / 4.62 GiB disk** available. Policy keeps 2 GiB host headroom + 2 GiB per-Root reserve; two Roots need about 6 GiB before crediting only measured already-active Root sandboxes. No second-Root safe envelope existed. Physical max remains two, so three is unsupported. Provider RPM/TPM remain null/unobserved; historical unknown outcomes and unrelated active requests remain unknown, not healthy zeroes.

The real journal has **57 distinct attempts: 55 SETTLED/COMPLETED, two FAILED/UNAVAILABLE**; zero remaining STARTED canary attempts. Known provider-response IDs are unique. Duplicate replay added no journal rows. Known input + cache = inclusive input; inclusive input + output = total; reasoning is an output subset and is not added again.

| Canary | Known completed attempts | Known total tokens | Known official-reference USD | Failed usage |
|---|---|---|---|---|
| A2 | 29 | 2,014,205 | 0.05320141 | 2 UNKNOWN |
| B | 26 | 2,280,182 | 0.07637031 | None in this run |

Known reference total **0.12957172 USD** is algebraically reconciled from persisted `inception:mercury-3:launch:2026-10-29` snapshots. It is not an invoice, actual provider debit, customer charge or complete total including the failed attempts. Financial/reservation fields remain null where the existing reference-only path retires model-credit charges. [Reconciliation](acceptance3-usage-reconciliation.json) retains these limits. Autoscaling changed no paid admission or provider/token budget.

The verified test customer hash `a6c5c8279d66930d` received **1,000,000 INTERNAL_TEST_GRANT credits** through the existing `appendLedger()` kernel/projection, reference LCSP-364, fixed unique key and atomic audit. Wallet **0 → 1,000,000**, reserved zero. After quiescence, **INTERNAL_TEST_GRANT_REVERSAL** ledger `f07eaa1b-a754-4d3e-99ab-53544990fd65` reversed unused credit through the same kernel: **1,000,000 → 0**, version **1 → 2**, reserved zero. Ledger consumption zero reflects the existing retired debit path, not zero provider cost. Each grant/reversal exists once; no payment/order/webhook/revenue was fabricated. [Grant](acceptance2-credit-grant.json), [verification](acceptance2-credit-verification.json), [reversal](acceptance3-test-credit-reversal.json) and [post-rollback state](acceptance3-post-rollback.json) retain actual zero payment counts.

## J. Screenshots, failure recovery and rollback

- Actual UI, excluding private conversation: [B HITL](acceptance3-canary-b-hitl.png), [A2 resumed HITL](acceptance3-canary-a2-resumed-hitl.png), [A2 Root/execution/checkpoint details](acceptance3-canary-a2-runtime-details.png). Browser BUILD_ID matches deployment.
- [Quiescent restart](acceptance3-quiescent-restart.jsonl): authenticated drain, LCSP Runtime and API/controller restart only; **21 canonical table fingerprints** and configuration unchanged. [Replacement native state](acceptance3-native-state-after-restart.json) returns both exact checkpoints. Unrelated processes untouched.
- [Stale-owner control](acceptance3-stale-incarnation.json): correctly authenticated/schema-valid old incarnation report/reserve/quiesce each returns **409 ASSESSMENT_ROOT_CAPACITY_STALE_OWNER / SERVER_INCARNATION_FENCED**. No slot released/reserved. Initial receipt assertion used a shortened code; final capture asserts the actual shared value.
- [Real broker redelivery](acceptance3-redelivery.json): quiescent SIGTERM, three exact old commands durably confirmed, unacknowledged channel close and actual new-channel redelivery (delivery tag 1 reused). Restarted real worker settles all; ready/unacked zero, canonical fingerprints identical, extra invocations/reservations **0/0**. This is not an active-Root crash claim.
- [Audited rollback](acceptance3-bounded-rollback.json): adaptive false, override null, emergency false, initial/max two. Safety remains enabled; [final status](acceptance3-final-status.json) desired two / effective one / active zero, MEMORY_PRESSURE. HITL/pins/checkpoints/journal intact. Observer stopped normally.

Preserved private off-host 44 build/config archive: **252,329,925 bytes**, SHA-256 `cf43081a20d68928785b16bdb1b4d10a3598101e143574b42829a026b46aa032`. Superseded 752 candidate archive: **291,879,226 bytes**, SHA-256 `58fc34118535e2a7ab1df4f40c00c8f7b7bf544b4e3fbe7125d38e63f4319312`. Archives contain configuration and are not published.

**Current binary rollback to 44 remains BLOCKED while isolated Assessments are unfinished.** Legacy publishers/logins cannot safely continue OWNED_PENDING work. Keep the fence/current identity and use the tested policy rollback. Do not remove isolation or kill a Root for an old binary. Earlier 752→44 rollback is historical evidence, not a new binary rollback PASS.

## K. Acceptance and final verdict

| Gate | Status | Scope and remaining condition |
|---|---|---|
| Architecture | PASS | Single Root, durable API/DB admission, supported single server |
| Adaptive control | PASS | Deterministic 1→2→N→2→1; isolated native peak 3; real automatic 0→1 and refusal |
| Global cap | BLOCKED production-wide | Upgraded PG/two-bridge/canary boundaries PASS; external legacy executions are not claimed globally enrolled |
| Resource safety | PASS | Actual RAM refusal, disk policy met, DB/checkpoint/Docker/provider provenance; unknowns retained |
| Stability | PASS | Cooldown/hysteresis and stale/pressure regressions; no unsafe expansion |
| Fairness | BLOCKED full production skew | Real 8-target owner-rotation and >10,000 regressions PASS; B progresses after A2 release |
| Broker correctness | PASS | Actual duplicate/channel-close/tag-reuse/restart and real SDK/MQ regressions |
| Agent Server lifecycle | PASS supported topology | Quiescent fenced replacement and persisted exact checkpoint reads; no replicas |
| Stop/Continue | PASS A2; simultaneous case BLOCKED | Actual canonical parent chain; no two-Root production envelope |
| HITL | PASS release; post-answer case BLOCKED | Both native executions quiescent, zero slots; genuine answers not supplied |
| Legal semantics | BLOCKED production completion | CI regressions PASS; real canaries need authoritative facts, zero decisions/report |
| Usage accounting | BLOCKED complete monetary acceptance | Unique attempts, known cost algebra and grant/reversal PASS; failed usage/invoice UNKNOWN |
| Automated tests | PASS | Exact runtime-head 37/37 plus focused/broad receipts; skips explicit |
| Load matrix | PASS provider-free | Exact-head native 1/2/4/8; no paid eight-target or ≥2 production overlap claim |
| Production canary | BLOCKED complete A–H matrix | Native/Stop/HITL/refusal/restart/duplicates real; active-Root crash/full report scenarios unexecuted |
| Rollback | PASS policy; binary BLOCKED | Data-preserving disable tested; unfinished isolated work bars old binary |
| PR CI | PASS runtime head | Final evidence-only HEAD checks must also complete on PR |
| Independent review | BLOCKED | CHANGES_REQUESTED remains; author did not approve, dismiss, merge or mark Done |

Remaining acceptance requires genuine human-fact/report completion, required review, an appropriately provisioned environment for simultaneous paid-Root scenarios, and separately controlled active-execution fault recovery where required. No threshold was lowered, operational fact fabricated, missing usage zeroed or historical row rewritten to turn a gate green.
