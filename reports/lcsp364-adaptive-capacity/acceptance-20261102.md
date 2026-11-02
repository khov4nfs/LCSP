# LCSP-364 — real native concurrency, 2026-11-02

**Verdict: BLOCKED for complete production acceptance, merge and Done.** A representative isolated stack now proves automatic **1 → 2 → 1**, two genuinely concurrent native Roots, one canonical Root per Assessment across two API/two bridge processes, Stop C while D continues, canonical Continue, HITL release and duplicate redelivery without extra work. This is live-provider evidence, separate from scripted-model CI and from Fogewise's previously measured peak of one.

The user's exact answer **“chưa biết”** was recorded through the existing `doesNotKnow=true` contract for the eight Fogewise human requests. It creates no fact and resolves no blocker. Fresh production reads still show both canaries at WAITING_FOR_HUMAN, zero decisions and zero report artifacts. No legal/report PASS is claimed.

## A. Baseline and implementation

Source during this experiment: PR #442 HEAD **31f27042970b5aa6945e612af283a6e61aee3fa2**. The native Docker image is exactly **sha256:dbdcb42c039f99a2343de952c7cc7b73f106766eb0199811f64738cf66bb2160**, built from **2cd94a65e26397a1bb486a6ba4de2c168d152192**. [Object identity](acceptance4-source-parity.json) proves apps/packages/deepagents/scripts/process-manager/deployment source unchanged between these revisions. Evidence publication does not change runtime code.

The representative host has 16,464,646,144 bytes RAM. Two actual Nest API processes and two actual RabbitMQ bridge processes share one API PostgreSQL database and one authoritative native Agent Server; checkpoints use a separate PostgreSQL database. Both API processes handled global reserve requests. Physical server capacity is two, each bridge has two workers/prefetch two, and native researcher concurrency remains one. No executor resize, Agent Server replica or second decision authority was introduced.

[Services](acceptance4-services-20261102.json), [image](acceptance4-image.json), [policy identity](acceptance4-model-policy.json), [typed source import](acceptance4-seed-import.json). The isolated database received the real sealed eight-document corpus, 633 legal requirements and 243 assessment rules, retaining exact typed rows, constraints and triggers. No Assessment, execution, usage, wallet, payment or session history was copied. New Assessments own new Root/thread IDs.

## B. Root cause and fix

**Root cause:** the first isolated container could not observe sandbox usage because Docker CLI was absent, and its private cgroup namespace hid ancestor limits. Admission correctly remained at zero. A separate setup failure was the isolated test customer's missing provider credential, before any paid Root began.

**Fix:** expose the actual host cgroup namespace and complete hierarchy read-only, mount the compatible host Docker CLI read-only, and retain the existing socket and actual machine identity. The server has an 8 GiB cgroup ceiling and four CPU cores. Import only the exact test customer's already-encrypted repository credential; plaintext was never exported and the NHI Git credential was not repurposed for application access. [Credential receipt](acceptance4-repository-credential.json).

No metric guard, 2 GiB memory headroom, 2 GiB per-Root reserve, 4 GiB disk policy, provider budget or paid admission was weakened. The earlier Fogewise wrong-writer failure and its OWNED_PENDING/session-user fence remain documented in [the October 31 report](acceptance-20261031.md); its original exception/worker identity remains UNKNOWN.

## C. Architecture and ownership

[ADR](../../docs/adr/LCSP-364-adaptive-root-admission.md) remains the implemented design: API/PostgreSQL serializes global admission and canonical leases; RabbitMQ owns durable delivery; one Agent Server executes bounded native work. Physical reservations remain held until actual execution quiesces. The canonical Assessment Root thread is distinct from the transport thread; transport metadata and physical run ID link them without creating another decision-owning Root.

[Native proof](acceptance4-native-proof.json) links four physical segments to four persisted native transports and three canonical threads. No two physical segments for one Assessment overlap. The [replica trace](acceptance4-api-replica-trace.json) shows both API processes serving the shared reserve boundary. The test router only forwards HTTP round-robin per operation, with no retries or scheduling authority. This proves the upgraded shared-database topology; it does **not** establish enrollment of every external legacy production writer.

## D. Changes and commits

Runtime source is unchanged from the reviewed implementation and reviewed P1 fixes described in the October 31 report. This update adds revision-bound real-provider evidence, the user's unknown-answer receipt, a capacity chart and container telemetry guidance. No new legal, billing or scheduling function was added. Unrelated local WIP and external processes were preserved.

## E. Automated verification

The [exact experiment-source receipt](acceptance4-experiment-source-ci.json), 31f270429, verifies **40/40 CI checks**. The runtime implementation 2cd94a65e passed **37/37**, including real PostgreSQL/RabbitMQ, Docker and native scripted-model tests. These historical results are not assigned to a newer evidence-publication HEAD; exact new-HEAD checks are maintained on PR #442. Mandatory business documentation verification on this update reports zero missing/invalid functions and five checker tests PASS.

New capture assertions verify: peak two in SQL and the direct native sensor; both API replicas; unique invocation/provider-response IDs; checkpoint progress inside both overlap intervals; Continue ancestry; all physical releases; token/reference-cost algebra; zero new work after duplicate delivery; and unchanged canonical table fingerprints. These assertions use actual captured execution and persisted state, rather than simulated model results. Earlier focused/regression receipts and skipped-test limits remain in the preceding report.

## F. Production state and rollout boundary

There was **no new Fogewise activation or paid execution in this round**. [Fresh production receipt](acceptance4-fogewise-legal-status.json), 2026-11-02 03:41 UTC, confirms runtime **2cd94a65e**, unchanged environment fingerprint **fd98df1b7cc562d5f9884cdd7ebd36495a4cc574da7b9468b5bff308d099b471**, HTTP health 200, **4,808,925,184 free disk bytes**, no held A2/B slots and test wallet/reserved balances both zero. Their original Root IDs/checkpoints are intact.

Production adaptive mode remains disabled under the previously audited bounded rollback. The representative environment supplies the safely supported two-Root proof that Fogewise's observed memory envelope could not supply. It is not described as a production concurrency increase or a new production deployment PASS.

## G. Actual load and concurrency

| Independent target | Exact repository pin | Initial wait to physical start | Outcome |
|---|---|---:|---|
| C, ProctoAI | shreeram312/AI-Proctored-System @ 9ddb361e4cd52aafe4e1d0763f57005a607efae6 | 0.604 s | Stop, same-Root Continue, HITL |
| D, credit scoring | Kowshik-18/credit_score_engine @ 132b5d796b32bf2f4454990b64df7d0435e28161 | 46.340 s | HITL |
| E, CheatShield | vishal017/cheatshield @ af4a55a86244f68d749d43b40f13678defdfff81 | 106.266 s | HITL |

Controller observations automatically change one to two at **03:31:35.300 UTC**, reason BACKLOG_HEADROOM, and two to one at **03:34:26.037 UTC**, reason LOW_DEMAND. Those are observer timestamps; durable physical timestamps are recorded independently. Minimum/maximum 1/2, three-sample hysteresis and 90/60-second up/down cooldowns were unchanged.

- C/D physical/native overlap: **48.479 seconds**, 03:31:34.169–03:32:22.648 UTC. During that interval C/D wrote **200/56** canonical checkpoints respectively.
- D/E overlap: **62.330 seconds**, 03:32:34.300–03:33:36.630 UTC. During that interval D/E wrote **231/264** checkpoints.
- Direct native sensor and durable reservation spans both peak at **two**, never three. Excess work remains durable/deferred; seven capacity deferrals were recorded before duplicate probes.
- Initial queue wait p50 **46.340 s**, p95 **100.2734 s**, only three samples; this is not a broad latency benchmark. Four native segment durations are 94.452/122.461/125.371/37.264 seconds. Completed-Assessment/report throughput remains UNKNOWN because all three genuinely need human input.

The provider-free 1/2/4/8 matrix remains in [the exact-runtime CI artifact receipt](acceptance3-native-load-artifact.json); peaks were 1/2/3/3 under its separately measured cap. This real-provider cohort submits three targets under a two-slot ceiling. It does not replace the 1/2/4/8 fixture matrix or claim paid eight-target throughput. All three new targets use the same verified test customer; cross-tenant fairness remains covered by the existing deterministic/PG matrix, not newly demonstrated by this cohort.

## H. Stop/Continue, HITL and legal facts

[Stop proof](acceptance4-stopped-while-d-active.json): C pauses at checkpoint **1f1d66e0-3baf-6df2-815b-8ed16704304c** and releases its physical slot at 03:32:22.648 UTC. D continues and creates **15 actual usage attempts after that release**. E takes a slot at 03:32:34.300 UTC. C's Continue retains logical execution **937d8ca6-5a88-4916-86f9-ee522cc22fd2**, thread **019bb6b0-2cd2-4730-9935-1af99684516b**, and reaches checkpoint **1f1d66e6-ff53-6c30-81b9-627430dee511**, **94 parent links** beyond the stopped checkpoint.

All three reach WAITING_FOR_HUMAN and every physical slot is released. Legal/source pins remain independent and unchanged. The existing production unknown answers leave all eight requests OPEN, fact counts unchanged at A2=5/B=1, and no forced continuation. [Exact unknown-answer receipt](acceptance4-human-unknown.json). The new canaries likewise do not acquire fabricated operator, deployment, jurisdiction or population facts. There are zero accepted decisions or final report artifacts, so semantic completion, Completion Gate, artifact activation/download and post-answer legal continuation remain BLOCKED.

## I. Resources, provider and monetary governance

[Summary](acceptance4-live-summary.json) covers **257 samples at approximately three-second intervals**, zero observer errors. Host available memory was **7,057,522,688–8,586,403,840 bytes**, free disk **7,932,825,600–8,986,169,344 bytes**, and server cgroup available memory stayed above **8,000,237,568 bytes**. Sandbox memory peaked at **563,323,338.752 sampled bytes**, sandbox CPU **1.0413 cores**, process RSS **562,991,104 bytes**, CPU/disk pressure **2.04%/3.82%**, DB connections **26/100**, DB latency **10.990 ms**, checkpoint latency **52.027 ms**, and observed active provider requests **two**. Docker-formatted bytes are approximate; shared Python RSS is not guessed as per-Root memory. Provider RPM/TPM limits remain unobserved/null, and no 429 or budget denial was observed in this cohort.

[Journal reconciliation](acceptance4-usage-reconciliation.json): **60 SETTLED/COMPLETED** attempts and **one FAILED/UNAVAILABLE**, with unique invocation IDs and known provider-response IDs. Input/cache/output and persisted official-reference price algebra reconcile to known **$0.13479441 USD**. The failed usage/cost remains UNKNOWN. This is not an invoice, actual provider debit, customer charge or complete total. [Sanitized attempts](acceptance4-usage-attempts.json) retain failure/cache attribution and the persisted reference-price snapshots.

The isolated exact test customer received its own audited **1,000,000 INTERNAL_TEST_GRANT**, reference LCSP-364 and unique environment-scoped idempotency key, through `BillingAccountingKernel.appendLedger()` and the wallet projection. After actual work drained, reversal **da81554b-5e1c-4ea8-8c9b-cbadbff7149b** returned **1,000,000 → 0**, reserved zero, version 1→2. [Grant](acceptance4-test-credit-grant.json), [reversal](acceptance4-test-credit-reversal.json). Used wallet credit is zero because the existing model-credit debit path is retired; provider usage/cost is not zero. No SePay payment transaction, webhook or revenue was fabricated and no customer wallet was funded. This is separate from the already-closed production grant.

## J. Traces, charts and rollback

- [Capacity timeline chart](acceptance4-capacity-derived.png), [SVG](acceptance4-capacity-derived.svg): **derived from captured measurements, not a live screenshot**. [Raw timeline](acceptance4-capacity-timeline.jsonl) retains desired/effective/admitted/actual Roots, queue pressure, CPU/memory, provider/DB/checkpoint sensors and provenance/freshness. The later DB observer supplements the full durable physical spans; it is not claimed to have sampled the start of C/D overlap.
- [Real RabbitMQ interruption](acceptance4-redelivery.json): both owned bridges receive quiescent SIGTERM, four original commands are durably published, a real unacknowledged channel closes, the next channel redelivers with reused tag 1, and both bridges restart. **Zero additional invocations/reservations**, unchanged cohort canonical-table fingerprints. This is not an active-execution crash proof.
- [Bounded rollback](acceptance4-bounded-rollback.json) and [final status](acceptance4-final-status.json): adaptive false, initial/max two, override null, emergency false, active zero, effective two, healthy. Policy change invalidates the old report and conservatively exposes effective zero for four samples until fresh evaluation; no Root is killed. The resulting status is ADAPTIVE_DISABLED. History in the final receipt is limited to ten entries; the raw timeline is retained.
- [Quiescent shutdown](acceptance4-quiescent-shutdown.json) verifies zero actual native runs/reservations before stopping only the two owned APIs, two bridges, router and server container. Databases, checkpoints, broker and repository sandboxes are preserved; production services and unmanaged processes were untouched. [Artifact manifest](acceptance4-artifact-manifest.json) records content hashes; [plot source](acceptance4-plot.py) regenerates the derived chart from the published measurements.
- October 31 [production UI](acceptance3-canary-a2-runtime-details.png), [production restart/fencing](acceptance3-quiescent-restart.jsonl) and [production rollback](acceptance3-bounded-rollback.json) remain dated evidence for those actual experiments. No new UI capture or production overlap is inferred from this round's chart.

Binary rollback to legacy publishers remains blocked while protected production Assessments are unfinished. Keep their isolation and current authority; use the tested bounded policy. No external instance was stopped or investigated beyond the technical writer boundary.

## K. Acceptance and final verdict

| Gate | Status and precise scope |
|---|---|
| Architecture / global ownership | PASS upgraded two-API/two-bridge stack; production-wide legacy enrollment still BLOCKED |
| Adaptive control / stability | PASS actual live-provider 1→2→1 and safety-preserving policy reset; configured headroom/hysteresis/cooldown unchanged |
| Resource safety | PASS measured representative envelope; Fogewise's historical one-slot refusal remains valid |
| Fairness | Existing deterministic/PG tests PASS; new sustained multi-customer production test BLOCKED |
| Broker correctness | PASS actual lost ACK, redelivery/tag reuse, quiescent bridge restart, no new canonical work |
| Agent Server lifecycle | PASS supported one-server topology; no horizontal replicas |
| Stop/Continue | PASS actual C Stop while D progresses; same logical Root and proven checkpoint ancestry |
| HITL | PASS actual quiescent release for all; post-answer legal continuation BLOCKED without genuine facts |
| Legal semantics / final report | Regression proof retained; genuine legal/report completion BLOCKED, no accepted decision/report created |
| Usage accounting | Known reference/cache/failure attribution and ledger reversal PASS; failed cost/invoice UNKNOWN, full monetary acceptance BLOCKED |
| Automated / 1/2/4/8 matrix | Existing exact-source CI and fixture artifact PASS; final publication-HEAD CI checked separately |
| Production canary | Prior Fogewise native path PASS within one-slot envelope; complete production/legal/fault acceptance BLOCKED |
| Failure recovery | Quiescent duplicates/restarts PASS; active-execution crash scenarios remain unexecuted/BLOCKED |
| Rollback | Audited bounded-mode rollback PASS; current legacy binary rollback BLOCKED by unfinished protected work |
| Independent review | CHANGES_REQUESTED remains; normal re-review required before merge |

No acceptance criterion was weakened. Real concurrency proof closes a specific earlier gap, while missing real-world facts still prevent legal/report completion. Keep Jira **In Progress** and PR #442 open; do not merge or mark Done.
