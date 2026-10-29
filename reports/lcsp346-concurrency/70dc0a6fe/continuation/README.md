# LCSP-346 — continuation, Stop/Continue and final acceptance checkpoint

**Bounded concurrency and live Stop/Continue pass. Overall acceptance is BLOCKED.** A remains in `WAITING_FOR_HUMAN`; B reached supported `BLOCKED / HUMAN_FACT_UNRESOLVABLE`. Neither fresh benchmark has a final report. Production semantic review also found six unsupported applicability decisions in B. No incomplete or failed case is reported as a successful completed Assessment.

Implementation/local/remote PR/VPS HEAD: **`70dc0a6fe40c618bdf47d532f9baa5230e52faf1`**.
PR [#440](https://github.com/khov4nfs/LCSP/pull/440) is open for review, unmerged and `REVIEW_REQUIRED`. The earlier [execution/deployment report](../README.md) and [initial PR evidence comment](https://github.com/khov4nfs/LCSP/pull/440#issuecomment-6486539601) remain historical checkpoints. This continuation is the later result.

## A–D. Implementation, root causes, architecture and code

The implementation remains unchanged: default prefetch 1 serialized a consumer with four threads; prefetch could inflate an explicit worker limit, and executor submissions could grow across reconnects/timeouts. The committed fix uses authoritative worker limits, bounded lifetime submission credit, copied Contexts, shared broker channel credit and a matching server recovery cap. Confirmed durable deferral and delivery-local thread-affine settlement retain the existing broker/lease/idempotency architecture.

Effective production worker / prefetch / server execution capacity remains **2 / 2 / 2**. The bridge has one Root consumer and 15 boundary consumers sharing channel credit two. The four-core, approximately 8 GiB host had 3,484 MiB available memory while two Roots were active; disk had 2.5 GiB available. No cap was raised, active unrelated job stopped or unrelated data/image/cache deleted. Researcher concurrency remains one; no production researcher task was invoked or declared safe above one.

The twelve implementation/test/config/doc changes and commit are listed in the earlier report. Root legal tools, runner, API Assessment/Billing trees and legal instruction prefix are byte-identical to verified `develop` baseline `70ddc3c086678edabb6b7a9f6627685841afbafb`; [Git object comparisons](governance-baseline-identity.json). No LCSP-345/347 or retired execution authority was introduced.

## E. PR and CI

At the 03:52 UTC checkpoint, exact implementation-head CI is **40 successful / 4 intentional skipped**, with no failure or pending checks: [final PR check metadata](final-pr-state.json), [44 check runs with their actual head SHA](implementation-head-checks.json). Additional successful Jira-link checks were triggered by PR metadata updates after the earlier checkpoint. The [earlier CI logs and test matrix](../README.md#e-pr-ci-and-automated-tests) record 2002 Python passes, 1479 API unit/integration passes and 176 API E2E passes, with explicit skips; separate local results and original setup failures remain recorded. Original Fogewise XML verifies 24 provider-free broker/concurrency tests plus one native two-Root control probe.

The live control/evidence checker also passes: [script](verify_control_evidence.py), [result](control-verification.json). Its result explicitly retains **semantic acceptance FAIL** and **monetary reconciliation BLOCKED**; successful identity/control assertions do not convert these to PASS. No further source change or deployment was made after the tested implementation commit.

## F. Production deployment and final state

The earlier real rebuild deployed exact PR HEAD from clean production `develop` `70ddc3c086678edabb6b7a9f6627685841afbafb`, after safe fetch/switch/fast-forward pull. Actual frozen runtime/sandbox build, wheel and bytecode rebuild preceded all recorded executions. Only the affected runtime restarted, at 2026-10-28 17:40:40 UTC; the API/Web processes and server-local settings were preserved. No migration or manual domain-state update was performed.

The later [read-only production snapshot](final-production-observation.json.gz) confirms clean `/srv/apps/LCSP` on the feature branch at the exact implementation SHA, matching runtime source hashes and image revision. Runtime image: **`sha256:c4b9c49555981880f203d6a9cc77bc71f0aae6d3b750ac43c912c7f1e61e4de1`**. API, Agent and Web health are 200. API-owned leases, distinct sandbox pins and broker connectivity are retained. Neither benchmark has a live execution lease after its human interrupt/blocker.

[Deployment evidence screenshot](screenshots/deployment-health-evidence.png) is explicitly labelled a **static operator view of the read-only observation**, not a live application dashboard. Its [HTML source](deployment-health-evidence.html) contains no secrets. This remains an unmerged PR acceptance deployment, not a finalized release.

## G. Real execution matrix

Account A owner: `2e723a25-b79c-4aac-a094-5771f3fbc590`.
Account B owner: `d3f2f078-78f1-4480-8a8d-9e134a356da1`.

| Account | Repository / pinned commit                                                                                             | Assessment ID                          | Canonical Root execution ID            |
| ------- | ---------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | -------------------------------------- |
| A       | [AI-Proctored-System](https://github.com/shreeram312/AI-Proctored-System) · `9ddb361e4cd52aafe4e1d0763f57005a607efae6` | `db6266b2-4e16-4ced-8595-7ffe9e33f3ab` | `1fe90257-e296-48cb-a2d0-b1de79384092` |
| B       | [credit_score_engine](https://github.com/Kowshik-18/credit_score_engine) · `132b5d796b32bf2f4454990b64df7d0435e28161`  | `06ad978f-0ada-46f9-b648-e2c86aee37c1` | `aca38bac-2091-4b24-8fc2-3a6de9f141d5` |

Times below are actual native Root boundary events, in UTC. A canonical Root/thread intentionally survives multiple authorized turns.

| Account / turn       | Date       | Actual start | Actual end   | Result                                                           |
| -------------------- | ---------- | ------------ | ------------ | ---------------------------------------------------------------- |
| A initial            | 2026-10-28 | 18:00:54.477 | 18:04:12.071 | Native human interrupt                                           |
| B initial            | 2026-10-28 | 18:01:16.100 | 18:05:11.935 | Native human interrupt                                           |
| A human continuation | 2026-10-29 | 03:10:32.323 | 03:12:07.046 | PAUSED through supported Stop                                    |
| B human continuation | 2026-10-29 | 03:12:16.679 | 03:14:55.674 | PAUSED through supported Stop                                    |
| A Stop continuation  | 2026-10-29 | 03:15:04.596 | 03:19:01.766 | WAITING_FOR_HUMAN; four provider-practice facts remain unknown   |
| B Stop continuation  | 2026-10-29 | 03:19:11.721 | 03:19:17.391 | BLOCKED / HUMAN_FACT_UNRESOLVABLE; five dependencies remain open |

Initial actual Root overlap is **175.971 seconds**. Independently matched MODEL_CALL_STARTED/COMPLETED intervals establish **78.725 seconds of actual simultaneous logical model-call execution**, [interval evidence](actual-model-overlap.json). These are not queue labels or futures.

### Backpressure and handoff

The customer's other two grading Assessments occupied both workers before A/B's human replies completed. The broker retained two ready continuations behind two unacknowledged deliveries; both active Roots were observed making model progress. No continuation was acknowledged as successfully executed merely for entering a queue.

The first grading Root completed normally, then queued A acquired the released capacity. Stopping A released capacity to queued B. Stopping B released capacity to A's existing Continue request. A's next human interrupt released capacity to B's existing Continue request. All transitions stayed within the two-worker bound and left the remaining grading Root untouched. The long queue waits are reported rather than hidden: A/B's human continuation commands published at 02:35:18.610 / 02:36:42.028 UTC and reached actual Roots at 03:10:32.323 / 03:12:16.679 UTC.

### Latest check of the three customer-linked Assessments

The [03:52:27 UTC read-only status and broker check](question-current-status.json) answers why `db6266b2…` did not run as a third concurrent Root. The supported cap is two; the two grading cases occupied both slots when its continuation was published. It actually started at **03:10:32.323 UTC**, ten seconds after `ce1d9e22…` completed its native turn. Its later wait is now a human checkpoint, rather than lack of worker capacity.

| Assessment                             | Latest state                    | Latest observed native turn end |
| -------------------------------------- | ------------------------------- | ------------------------------- |
| `db6266b2-4e16-4ced-8595-7ffe9e33f3ab` | WAITING_FOR_HUMAN / INTERRUPTED | 03:19:01.766 UTC                |
| `ce1d9e22-5460-4a16-b53f-d646a942478d` | COMPLETE / SUCCEEDED            | 03:10:22.357 UTC                |
| `bcf4d105-1f2a-48c9-8251-1197d34d38f1` | WAITING_FOR_HUMAN / INTERRUPTED | 03:38:57.454 UTC                |

At that snapshot there were zero live API leases, zero ready Root deliveries, zero unacknowledged Root deliveries and one connected Root consumer with prefetch two. Neither grading case was stopped or changed by the acceptance controls. Times in this subsection are 2026-10-29 UTC; add seven hours for Vietnam time.

## H. Live Stop/Continue, checkpoints and isolation

- A reached API `PAUSED` at **03:12:07.233 UTC**, checkpoint **`1f1d3468-5abd-6e9c-81c2-f311b14fe3f1`**. Continue accepted at 03:12:54.979; the same Root/thread actually resumed at 03:14:56.345 (claim) / 03:15:04.596 (native boundary). The final checkpoint descends from that stopped checkpoint.
- B Stop requested at **03:14:44.810 UTC**, reached `PAUSED` at **03:14:55.745 UTC**, checkpoint **`1f1d346e-a13d-6052-8329-fc37f070ceb8`**. Continue accepted at 03:15:31.053; the same Root/thread resumed at 03:19:02.343 / 03:19:11.721. Its final blocker checkpoint descends from its stopped checkpoint.
- A's first harness wait expired at 20 seconds; subsequent API/native state proved the valid PAUSED outcome without another Stop request. B's 45-second wait completed normally. Neither timeout is hidden or reported as an extra successful run.
- There were **zero accepted evidence/decision events in either paused interval**. B's six accepted decision IDs stayed unchanged across Stop/Continue, and B made **zero extra provider calls** after Continue: its saved model result proceeded to pending human-unavailability tools without replaying inference.
- The direct cross-account stop observer was the customer's untouched Account A grading Root `092b8818-7b97-4e4e-9b0a-f591f1c92c66` (`bcf4d105-1f2a-48c9-8251-1197d34d38f1`). It stayed RUNNING under the same execution while Account B stopped; its invocation counter advanced 650 → 651. Its controls were never used.
- The original benchmark pair was not simultaneously active at the moment of these Stop clicks because one unrelated grading Root retained the other slot. The observer identities/timing are explicit; the tests are not misrepresented as that original pair overlapping during Stop.
- After refresh, own checkpoint/stream state remained associated with the correct account. Final cross-owner timeline requests still return 404. See [final browser evidence](final-browser-evidence.json).

[A paused / B active screenshots](screenshots/A-stopped.png), [credit B active after A paused](screenshots/B-active-after-A-stop.png), [B Stop receipt and observer progress](production-stop-b.json), [A actual restoration / B Continue](production-continue-b-and-restored-a.json), [control invariants](control-verification.json).

## I. Usage and legal governance

| Attribution                    | A         | B         |
| ------------------------------ | --------- | --------- |
| Physical invocation IDs        | 54        | 41        |
| SETTLED / UNAVAILABLE          | 53 / 1    | 41 / 0    |
| Uncached input tokens          | 1,242,211 | 683,613   |
| Cached input tokens            | 3,323,371 | 3,367,520 |
| Output tokens                  | 96,079    | 82,021    |
| Reasoning subset, not additive | 67,442    | 63,145    |
| Reported total tokens          | 4,661,661 | 4,133,154 |

All **95** physical invocations have correct Assessment/owner/Root attribution; all **190** STARTED/terminal callback records were delivered idempotently. Token sums match API/UI aggregates. A's original failed quota attempt remains explicitly unavailable, not zero usage. In-flight STARTED placeholders in earlier snapshots settled normally; B has no final unavailable record.

The route remains UNPRICED with no pricing/reservation IDs. Monetary billing/recovery is not claimed verified; owner is the existing Billing model-price/runtime-policy configuration. No pricing or admission policy was modified. Concurrent atomic paid-admission/fallback tests remain separate passing evidence.

### Semantic failure — independent blocker, not context leakage

**Root cause:** B's new case-revision-7 decisions infer an actual personal-data controller from CSV/model functionality, despite the accepted human context explicitly saying operator/deployment are unverified. For example, decision `9c694a98-aadf-412f-a1bf-df49c99dab65` applies `art10-cl3-withdrawal-restriction-implementation` on that inferred role. All six renewed decisions are APPLICABLE; five are NON_COMPLIANT and one COMPLIANT. These are not independently accepted legal conclusions.

The native checkpoint audit hydrated the real saved state read-only using the native graph schema, with **zero model/API calls**. Five resumed human tool results and a subsequent `get_assessment_context` all contain the benchmark/unknown-operator/deployment qualifications. The next recorded actions reload six original decisions, then resubmit six decisions. The context was present before these submissions; there is no evidence of cross-Assessment context contamination. [Checkpoint context hashes/flags/action identities](b-native-checkpoint-context-audit.json), [governing-code identity against develop](governance-baseline-identity.json), [actual decision rationales](post-resume-semantic-review-input.json).

**Fix boundary:** No legal heuristic, parallel semantic authority, prompt-only workaround or LCSP-360 refactor was added to LCSP-346. Correcting this existing semantic reconsideration/role-grounding path requires separately scoped LCSP-360 Assessment Root/governed-decision work. The governing code is unchanged from develop; no duplicate paid baseline model run was launched, so this is not claimed as a stochastic baseline-output comparison. The issue blocks semantic acceptance of the production results.

A's four new operational questions were answered through the supported **I don't know** control: all remain OPEN, factId is null, case revision stays six and no resume is enqueued. [Unknown-answer receipts](a-operational-unknowns-preserved.json). B used native permanent-unavailability handling and remains BLOCKED. Unknown facts were not made negative assertions or manually resolved; no database status or report was manufactured.

## J. Reports, screenshots and evidence limits

Neither fresh benchmark produced a final report. A is not terminal/complete; B is a valid blocked workflow outcome rather than a successful completed Assessment. Their report and final semantic acceptance gates remain unfulfilled.

An additional **read-only report-contract check** used the customer's already running grading case `ce1d9e22-5460-4a16-b53f-d646a942478d`, which completed normally at 03:10:22. Its stored artifact `56c3c8c6-b697-51ff-abff-cb79ff352401` has 243 findings, pins commit `ad756ce0d60c94f49e8b581639caa9d20f22cd05`, and downloads as 1,580,143 bytes with SHA-256 **`b1a8fe7b01371c8c42b97f74f2b09f7402b4b6f42882de9e18421a6c8dc8fdd9`**, matching persisted metadata. The real report page rendered 243 findings; Account B's direct download attempt returned 404. [Contract evidence](observed-report-contract.json), [completed case context](screenshots/observed-grading-complete.png), [report pins](screenshots/observed-report-pins.png). No full report/customer narrative was exported or independently semantically certified, and this case is not substituted for the two fresh benchmarks completing.

The original simultaneous two-active benchmark PNG pair was missed; native/model overlap traces prove that execution. Later Stop/control/final-state screenshots are genuine and timestamped. The deployment screenshot is an explicitly labelled operator evidence view. Earlier failed waits, temporary local-log loss and recovery, skipped tests, unavailable Jira-site access and credential-rotation follow-up remain documented in the earlier checkpoint.

## K. Final verdict

| Status                     | Result  | Evidence / limit                                                                                                         |
| -------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------ |
| IMPLEMENTATION             | PASS    | Bounded channel/executor/server; independent native Roots actually overlap                                               |
| AUTOMATED_TESTS            | PASS    | Exact-head Python/API/E2E/static plus 25 provider-free VPS tests; explicit skips                                         |
| PR_CI                      | PASS    | Exact HEAD, 40 successful / 4 skipped at 03:52 UTC; open review, unmerged                                                |
| PRODUCTION_DEPLOYMENT      | PASS    | Exact rebuilt revision/image/source parity and health 200                                                                |
| REAL_CONCURRENCY           | PASS    | 175.971 s Root overlap, 78.725 s logical model-call overlap, isolated pins/checkpoints                                   |
| STOP_CONTINUE              | PASS    | Both real canonical checkpoints restored; cross-account observer progresses; no paused writes or B inference replay      |
| STREAM_ISOLATION           | PASS    | Disjoint run/model/tool records, scoped SSE/refresh and final cross-owner denial                                         |
| USAGE_ACCOUNTING           | BLOCKED | Token attribution/recovery PASS; real monetary route remains UNPRICED without reservations                               |
| LEGAL_SEMANTICS_REGRESSION | FAIL    | Production semantic acceptance fails on six renewed B decisions; governing code unchanged, context preserved             |
| OVERALL                    | BLOCKED | Semantic blocker, unavailable operational facts and absent fresh benchmark final reports; missing original live PNG pair |

Do not merge or call this a finalized release. The LCSP-346 implementation/control work is delivered, but its full requested production acceptance has not passed. No change was made to unrelated active Assessments, source authority or production data.
