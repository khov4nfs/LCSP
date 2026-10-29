# LCSP-346 — final recovery and production acceptance

**Semantic and pricing defects are repaired, CI passes, and the exact PR revision is rebuilt on Fogewise. Fresh isolated Root overlap is 194.436 seconds. Overall acceptance remains BLOCKED by unexecuted fresh production report completion and normal review/merge.** The benchmark assessor cannot supply the missing real-world operational facts; neither fresh case is represented as complete.

Local implementation / remote PR / VPS HEAD: **`44dba336f332d566d3fee9fc0d32642a402d024e`**. PR [#440](https://github.com/khov4nfs/LCSP/pull/440) remains open, unmerged and subject to normal approval. This is PR acceptance deployment, not a finalized release.

The [previous 03:52 UTC A–K checkpoint](history-20261029-0352.md), [original implementation report](../README.md) and [previous PR evidence](https://github.com/khov4nfs/LCSP/pull/440#issuecomment-6487480325) remain historical evidence, including semantic FAIL and UNPRICED results. All times below are **October 29, 2026 UTC**; add seven hours for Vietnam time.

**Latest release-closure recheck:** PR/production remain at the same SHA, with zero post-deployment artifacts and no independent approval. The proposed synthetic scenario was not executed because production has no supported enforced scenario boundary, and verified context for an actual owned controlled deployment is still missing. [Closure evidence and explicit unexecuted gates](report-closure-20261029/report-closure-verification.json).

## A. Final implementation

The existing bounded architecture is preserved: one bridge/Root consumer, 15 boundary consumers sharing channel credit, bounded submissions, copied execution contexts, delivery-local settlement and API leases. Effective workers / prefetch / Agent Server capacity remain **2 / 2 / 2**. Researcher concurrency remains **one**. No scheduler, autoscaling, multi-repository execution, rule-selection scope or retired authority was added.

Recovery extends the existing decision contract/validator with source-indexed operative-scope findings, revalidates accepted replay and exposes pinned actor/activity scope through native tools. It appends a source-backed Mercury 3 reference-price version. There is no migration, historical repricing, bulk decision rewrite, wallet adjustment or manufactured report.

## B. Root cause and fix

**Root cause — semantic applicability.** All six captured credit rules are `UNCONDITIONAL` with empty additional-condition lists, but their operative propositions still declare controller actors/activities. The Root inferred an actual controller from CSV/model capability. Every captured packet omitted `applicabilityBasis`; validation checked additional conditions/qualifiers/exceptions without requiring operative scope. Accepted replay also returned before current validation. Saved human context contained the unknown operator/deployment answers: checkpoint loss and report transformation were not the origin.

**Fix.** `OPERATIVE_SCOPE` addresses each pinned operative proposition by requirement/index. `APPLICABLE` requires every declared scope explicitly `ESTABLISHED` with accepted references. Missing/unknown scope fails. Affirmative refutation may support `NOT_APPLICABLE`; absence of proof does not. Scope cannot substitute for a separate condition, and duty fulfillment remains a criterion finding. Replay satisfies current pins/revision/validation before returning its original effect. The existing Completion Gate invokes the same validator, including for old packets. Structural integrity remains deterministic; the Root remains the only legal interpreter. No role/article/jurisdiction keyword heuristic was introduced.

**Root cause — monetary route.** Canonical model roles use `INCEPTION / mercury-3`, despite obsolete provider environment metadata. Mercury 3 was missing from the official-reference registry although Inception publishes prices.

**Fix.** Append immutable `inception:mercury-3:launch:2026-10-29`, applicable from observed verification **06:03:04.588 UTC**: **$0.10 input / $0.01 cached input / $0.35 output per million**. [Official model page](https://www.inceptionlabs.ai/models), [captured source/hash](recovery-44dba336f/inception-mercury3-price-source.json). No earlier effective date, promotion end or invoice rate was invented. Historical snapshots stay unchanged. This is the existing **official-reference consumption estimate**, not an invoice/customer wallet charge.

**Evaluation defects also resolved.** CI exposed an untyped adapter and a scope-less legacy vertical fixture. A positive live fixture retained contradictory historical human-answer evidence. Another harness omitted the runner search callback, producing `NO_SEARCH_ACTIVITY` and a paid loop. Corrected harnesses preserve realistic accepted coverage/replay and trace only tool names/rejection codes, never prompts or hidden reasoning.

## C. Architecture and limits

`Create → repository setup / API transaction / outbox → RabbitMQ channel credit (2) → bounded boundary executor (2) → API lease → independent Root → canonical LangGraph checkpoint and pinned sandbox → existing Completion Gate → report artifact`.

A slow Root can overlap another. A third delivery waits; paused/human-interrupted work releases its lease. Continue reuses the same Root/thread/checkpoint. Settlement stays connection-thread-affine and delivery-local. No cross-replica global capacity guarantee is claimed. Original prefetch-one, worker-limit inflation and reconnect/timeout submission-growth fixes remain intact.

[Actual effective settings/executable hashes](recovery-44dba336f/recovery-effective-runtime-identity.json), [bounded broker pressure](recovery-44dba336f/recovery-after-slot-handoff.json.gz), [assertion checker](recovery-44dba336f/verify_recovery_evidence.py). Research above one remains disabled because shared search/usage attribution has not been proven safe.

## D. Code and commits

| Commit      | Change                                                                     |
| ----------- | -------------------------------------------------------------------------- |
| `70dc0a6fe` | Original bounded RabbitMQ/executor/server implementation                   |
| `85cc8ed98` | Operative scope, replay validation, native tools and six captured fixtures |
| `2ae57f20a` | Mercury 3 reference-price entry and accounting tests                       |
| `5e22e22bb` | Recovery contracts and LCSP-364 handoff                                    |
| `3f0335f99` | Probe import boundary/evaluation contract                                  |
| `e8ffd5dc9` | Unknown versus refuted scope; typed adapter and vertical fixture           |
| `906804aa9` | Sanitized trace and consistent positive-control evidence                   |
| `44dba336f` | Runner search callback and live native checkpoint-resume control           |

Production files: API `decision-validator.ts`, `submit-rule-decision.handler.ts`, `assessment-case-support.service.ts`; contracts `assessment/agentic-runtime.ts`, `billing/official-reference-pricing.ts`; Root `tools.py`, `instructions.md`. Tests cover captured packets, scope provenance, pin/revision/replay, Completion Gate, native interrupts and pricing/usage replay. No new dependency or migration.

The final two commits affect harnesses only. [File hashes](recovery-44dba336f/recovery-source-identity.json) prove earlier successful live controls exercised byte-identical production implementation; final-head controls additionally exercise native resume.

## E. Tests and exact-head CI

**36 successful checks; zero failed/pending at capture**, all at `44dba336f`. [Check metadata and URLs](recovery-44dba336f/recovery-44dba33-check-runs.json). The historical 43-success/4-skip result is not substituted for this revision.

| Local suite                                        | Result                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Full clean-environment Python                      | [2,005 passed / 25 skipped](recovery-44dba336f/recovery-python-clean.log)                                                |
| Broad API, serial                                  | [1,517 passed / 129 skipped](recovery-44dba336f/recovery-api-serial.log), 186 passing suites                             |
| API E2E, serial                                    | [175 passed / 22 skipped](recovery-44dba336f/recovery-e2e-serial.log), 20 passing suites                                 |
| Real RabbitMQ/concurrency/paid admission           | [142 passed](recovery-44dba336f/recovery-broker-admission-tests.log)                                                     |
| Focused API semantic/replay/Gate                   | [104 passed](recovery-44dba336f/semantic-focused-final.log)                                                              |
| Focused native Root                                | [80 passed](recovery-44dba336f/semantic-native-post-live.log)                                                            |
| Final native fixture/trace tests                   | [7 passed](recovery-44dba336f/semantic-probe-resume-tests.log)                                                           |
| Real API/PostgreSQL/native Root vertical           | [149 checks passed](recovery-44dba336f/domain-vertical-post-live.log), scripted model                                    |
| HITL/recovery/separate checkpoint database         | [72 checks passed](recovery-44dba336f/hitl-vertical-post-live.log), scripted model                                       |
| Billing kernel / migrated credential-index control | [13 passed](recovery-44dba336f/mercury3-kernel-tests.log) / [6 passed](recovery-44dba336f/credential-index-isolated.log) |

Formatting, lint, imports, contracts/retired authority, type checks and business-documentation checks/tests pass. Broad local suites preceded test-only harness corrections; final exact-head CI covers those corrections.

Failed setup history is retained: local `.env` polluted one Python config test (clean source passed); shared-schema parallel integration suites raced rebuilds; `db push` removed a migration-only index (fresh migrated suite passed); a broad API run exhausted default Node heap (bounded-memory serial run passed). No production index defect was inferred. [Adapter lint failure](recovery-44dba336f/ci-api-3f0335f.log), [scope-less vertical failure](recovery-44dba336f/ci-vertical-actual-3f0335f.log).

### Live semantic behavior

Provider-free captured-packet tests reproduced all six historical false positives before the fix and reject them afterward. Negative/positive controls also cover missing/refuted scope, independent conditions, revisions, repository pins, replay and report gating.

Live native Roots use real pinned credit source, effective legal corpus, model route, governance/admission and usage journal. Their **fixture API** invokes the real API validator: they are not production Assessments/reports. **Six unknown controls accept neither applicability verdict; six positive controls establish applicability from explicit synthetic operational facts.** [Per-rule findings](recovery-44dba336f/recovery-live-semantic-matrix.json).

Final-head live resume first interrupts at revision 8 with zero decisions, retains the old unknown answer/checkpoint, appends a distinct confirmed fact at revision 9, corrects rejected calls and reaches fixture completion using the new fact. This does not guarantee every future model judgment.

Earlier failures remain failures: the first live batch incorrectly produced three `NOT_APPLICABLE` verdicts and one inconsistent positive control; an initial 12-call ceiling was inconclusive; the missing-search-callback run was stopped after more than 100 paid attempts without yield. [28 captured result/history records](recovery-44dba336f/recovery-live-probe-attempt-history.json) retain failures and corrections. No failure was discarded to obtain green results.

## F. Production deployment

Closure recheck: 36 current successful check names / 38 successful exact-head check-run records, including repeat Jira checks; all three required contexts are green. The branch is zero commits behind develop. The active develop ruleset requires **one approval**, stale approval dismissal and resolved review threads. There are **zero reviews and zero review threads**, with reviewer `khov4nfs` requested. No approval or merge is claimed. [Ruleset](report-closure-20261029/report-closure-develop-ruleset.json), [review/merge state](report-closure-20261029/report-closure-reviews-protection.json), [CI](report-closure-20261029/report-closure-head-check-runs.json). The legacy branch-protection endpoint returned 404; repository rulesets, rather than that endpoint, provide the active requirements.

Preflight: clean feature HEAD `70dc0a6fe40c618bdf47d532f9baa5230e52faf1`, old image `sha256:c4b9c49555981880f203d6a9cc77bc71f0aae6d3b750ac43c912c7f1e61e4de1`, zero active leases/native runs, empty Root queue. `.env.pm2`/PM2 configuration hashes were captured. **136 migrations applied, zero incomplete; no migration ran.**

Safe fetch and normal **fast-forward pull** installed the exact pushed revision. Frozen-lock sandbox image, inexact host virtualenv sync (preserving unmanaged extras), wheel/bytecode, shared packages, API and Web were rebuilt. Only affected LCSP services restarted. Existing build directories and old image were preserved; no unrelated cache/image/data cleanup occurred.

Setup failures remain in evidence: missing host `uv` was resolved using pinned **uv 0.10.6** extracted from the rebuilt image into the owned build folder; one helper initialization error made no further change. Prisma initially lacked `DATABASE_URL`; the build passed through the existing `.env.pm2` loader without modifying it. [Initial attempt](recovery-44dba336f/recovery-deployment-44dba33.log), [helper failure](recovery-44dba336f/recovery-deployment-44dba33-resumed.log), [runtime/API setup](recovery-44dba336f/recovery-deployment-44dba33-resumed-2.log), [completed build/activation](recovery-44dba336f/recovery-deployment-44dba33-api-retried.log).

Final image **`sha256:0039d8bc2a963bf5d517e7732297c30ef9d8ffd7c56caeacc29378e9852e14e5`**, revision **`44dba336f332d566d3fee9fc0d32642a402d024e`**. API/Web/Agent health **200**; Web build `EJSKcxwfCMRL3Znem1qXx`. Runtime restarted **08:00:49**. Configuration fingerprints remain unchanged. Disk: **2.0 GiB available, 95% used**; capacity was not increased. [Final observation](recovery-44dba336f/recovery-final-production-observation.json.gz), [built identity/steps/effective settings](recovery-44dba336f/recovery-effective-runtime-identity.json).

Closure resource preflight at **10:07:17 UTC** confirms the same clean deployed revision/image and health 200, **zero artifacts created since the 08:00:49 deployment**, zero leases and zero running native runs. Disk: **2,132,709,376 bytes free (95% used)**; memory available **4,903,325,696 bytes**. Seven persistent sandboxes remain running with configured 2 GiB limits; no deletion/cleanup occurred. Four active/idle client DB connections were observed against max 100, plus five background processes. All 11 Docker images were active. [Read-only preflight](report-closure-20261029/report-closure-production-preflight.json). No new deployment was necessary because implementation HEAD is unchanged.

## G. Real execution matrix

A: `lcsp360-cheatshield-9e06c6e533@acceptance.invalid`, owner `2e723a25-b79c-4aac-a094-5771f3fbc590`.
B: `lcsp360-other-6b2cb2f5ca@acceptance.invalid`, owner `d3f2f078-78f1-4480-8a8d-9e134a356da1`. C is owned by A. Each pins one repository and the existing full **243-rule / 633-requirement** Rule Set.

| Account       | Repository / pinned commit                                                                                                     | Assessment ID                          | Root ID                                | Native start | Native end   | Result                               |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------- | -------------------------------------- | ------------ | ------------ | ------------------------------------ |
| A initial     | [AI-Proctored-System](https://github.com/shreeram312/AI-Proctored-System) · `9ddb361e4cd52aafe4e1d0763f57005a607efae6`         | `ecdf35c1-8487-4c3c-bd61-12666ee95ad7` | `578a6aad-2aa3-42ac-a531-ec0dbe4e0afb` | 08:06:13.938 | 08:08:49.513 | Supported Stop → PAUSED              |
| B             | [credit_score_engine](https://github.com/Kowshik-18/credit_score_engine) · `132b5d796b32bf2f4454990b64df7d0435e28161`          | `a7ae7cbe-59a8-4372-b5ff-fa2ab97c615f` | `c999cb54-1f5e-45b7-91bc-edcc49874978` | 08:06:40.678 | 08:14:33.082 | Native WAITING_FOR_HUMAN             |
| C queue probe | [AI-Exam-Grading-Tool](https://github.com/J-Sheerin-Farhana/AI-Exam-Grading-Tool) · `8578abdfc80e02e7c0dad8a1a478fecc174db7bc` | `9e3cd276-d157-48fd-bf62-be4fa67de6cd` | `ca4fbfa3-33bd-4576-9150-89c61be16215` | 08:09:09.567 | 08:13:03.058 | Supported Stop after admission proof |
| A Continue    | same pin                                                                                                                       | same Assessment                        | same Root                              | 08:13:27.481 | 08:17:02.584 | Native WAITING_FOR_HUMAN             |

Actual A/B Root overlap: **194.436 seconds**. Independently matched logical model intervals overlap **8.351 seconds**. Maximum actual active Roots: **two**. [Executable verification](recovery-44dba336f/recovery-verification.json).

A/B publication-to-worker waits: **1.143 / 1.154 seconds**; publication-to-native-Root: **35.316 / 62.069 seconds**, including real source/sandbox preparation. First model steps: **3.942 / 5.472 seconds** after native start. C waited **132.708 seconds** to worker lease / **151.795 seconds** to native start. [Timings](recovery-44dba336f/recovery-queue-and-first-progress.json).

C initially had no execution ID, lease or usage. Stop A admitted C; Continue A then waited behind B/C with broker **ready 1 / unacked 2**. Stop C admitted A. C was deliberately paused after admission proof to avoid further paid work, not labelled complete.

Original full IDs were rechecked: `db6266b2-4e16-4ced-8595-7ffe9e33f3ab` is now revision 10 after a **user-triggered 05:25 continuation**, WAITING_FOR_HUMAN / 84 invocations; `ce1d9e22-5460-4a16-b53f-d646a942478d` remains COMPLETE with report; `bcf4d105-1f2a-48c9-8251-1197d34d38f1` remains WAITING_FOR_HUMAN / 717 invocations. Original credit `06ad978f-0ada-46f9-b648-e2c86aee37c1` remains BLOCKED / HUMAN_FACT_UNRESOLVABLE, 41 invocations. [Storage evidence](recovery-44dba336f/recovery-original-cases-final-status.json). The original third-case delay was the intentional cap two; later waits are human dependencies. No unrelated controls were used.

**Closure-phase execution ledger:** zero new Assessments, Root executions, provider calls or reports; no additional metered usage. The original human waits/blocker/paused cases are unchanged. Fresh-report IDs/checksum/render/download/access-control results are absent, not PASS. The newly verified full report-workflow prerequisites and candidate disposition are in [scenario eligibility](report-closure-20261029/report-closure-scenario-eligibility.md).

## H. Stop/Continue, HITL and streams

Stop A: requested **08:08:43.503**, PAUSED **08:08:49.638**, checkpoint **`1f1d36ff-7da9-6eca-80dd-2b0770fac2aa`**. B stayed RUNNING on the same Root and advanced **9 → 10 invocations**. A Continue reused thread `7402b491-eb54-4a63-b405-57378da25d28` / Root; the final checkpoint descends from that exact stopped checkpoint. **Zero accepted writes occurred while A was paused.** A had no accepted decisions before Stop, so nonempty-set preservation is established separately by deterministic/historical controls. [Stop](recovery-44dba336f/recovery-stop-A-receipt.json), [Continue](recovery-44dba336f/recovery-continue-A-receipt.json), [C Stop/B progress](recovery-44dba336f/recovery-stop-C-receipt.json), [assertions](recovery-44dba336f/recovery-verification.json).

Supported UI “I don't know” answers were recorded once for three original-A questions, five original-B questions, six fresh-B questions and one fresh-A question. Every result: **OPEN, factId null, resumed false, unchanged case revision**. [Receipts](recovery-44dba336f/recovery-native-unknown-answer-receipts.json), [fresh A](recovery-44dba336f/recovery-new-A-unknown-receipt.json). Original blocked credit was not blindly resumed without new facts.

Fresh A checkpoint `1f1d3711-e7cd-69e3-820d-8cd82bbddf9f`; B `1f1d370b-cd15-6d29-81f8-9e8ca57d47c9`. Both have no live lease, no accepted legal verdict and no report: valid native human waits, not completed benchmarks.

Browser refresh loads the owner's own timeline (**83 A / 73 B events**); foreign Assessment/timeline requests return **404** both ways. Persisted interleaved execution/model/tool identities, checkpoint metadata and sandbox pins remain isolated. [Refresh/denials](recovery-44dba336f/recovery-browser-refresh-isolation.json), [timeline evidence](recovery-44dba336f/recovery-preserved-report-and-browser-timeline.json). No separate new active SSE network capture is claimed.

## I. Usage, monetary accounting, governance and security

| Case | Attempts / settled / unavailable | Uncached input | Cached input | Output | Total tokens | Known reference USD  |
| ---- | -------------------------------- | -------------- | ------------ | ------ | ------------ | -------------------- |
| A    | 25 / 25 / 0                      | 144,401        | 1,485,754    | 16,743 | 1,646,898    | $0.03515769 COMPLETE |
| B    | 26 / 25 / 1                      | 468,279        | 1,555,784    | 33,733 | 2,057,796    | $0.07419229 PARTIAL  |
| C    | 14 / 14 / 0                      | 106,944        | 610,553      | 7,773  | 725,270      | $0.01952048 COMPLETE |

**65 unique physical attempts, 64 completed logical calls, 130 delivered STARTED/terminal callbacks**. Tokens and integer monetary estimates reconcile exactly with customer API totals. Cache writes are zero; reasoning is an output subset. [Totals](recovery-44dba336f/recovery-customer-usage-totals.json), [reconciliation](recovery-44dba336f/recovery-verification.json).

B's real provider failure/fallback uses two distinct physical identities under one logical invocation. The successful attempt settles to B; the failed attempt remains `UNAVAILABLE / PROVIDER_USAGE_METADATA_MISSING`, with **null estimated cost / UNKNOWN**, not zero. Known combined reference cost is **$0.12887046**; B and the combined total remain partial. This meets the established reference-estimate contract's missing-usage behavior. **Provider invoice and customer wallet billing are not certified; total actual spend is not asserted as the known amount.** A continued independently during B's failure.

All **125 historical usage snapshots, 31 decision records, repository pins and artifact state** match pre-deployment hashes; old snapshots remain UNPRICED. [Preservation proof](recovery-44dba336f/recovery-historical-state-preservation.json). Historical unsupported decisions remain audit history and cannot pass current validation/Gate without governed reconsideration; they were not relabelled as correct.

**Security follow-up resolved for the documented credential.** The affected local development PostgreSQL password was rotated **06:44:20 UTC**. Private comparison found no production-process credential match; new authentication passes, old password is rejected, dependent local DSNs updated atomically, unrelated environment/production config preserved. [Rotation](recovery-44dba336f/local-credential-rotation.json), [scope](recovery-44dba336f/credential-scope-check.json). No claim of unrelated provider/SMTP/Git rotation. Published logs are sanitized/scanned; screenshot pixels reviewed.

Closure usage inspection confirms only the earlier 64 SETTLED / 1 UNAVAILABLE post-deployment attempts, with unchanged case totals. The usage-only journal has no inference-admission tables: the first read-only diagnostic incorrectly queried one and failed; the corrected preflight records this limitation. No new provider readiness/admission request was attempted. One global quarantined usage row predates deployment (October 23) and is outside these recovery cases; it was preserved, not treated as a new LCSP-346 regression. [Usage scope and zero added calls](report-closure-20261029/report-closure-usage-status.json).

## J. Reports and evidence

**Fresh production report generation remains BLOCKED / unexecuted.** A/B legitimately require facts unavailable to the benchmark assessor. No false facts or report artifacts were created to force completion. Real API/PostgreSQL/native Root report contracts pass with a scripted model.

### Eligible scenario and exact owner decision

Production supports ordinary customer factual answers, not an enforced hypothetical test-world boundary. Known answers become accepted `HUMAN_PROVIDED` facts; the authority set is only HUMAN_PROVIDED/EVIDENCE_CITED. Fact, Root and report schemas have no scenario discriminator, and the Assessment name/description is not projected as a frozen Root scenario scope. Labels can survive in referenced statements/narratives, but no mandatory report field prevents a hypothetical from being represented as an actual operational conclusion. A free-text/name marker would be an unenforced workaround, so it was not used. [Pinned source findings](report-closure-20261029/report-closure-source-contracts.json), [provider-free contract probe](report-closure-20261029/report-closure-contract-probe.json).

A real controlled execution with independently supported facts can use the normal workflow: owned/operator-authorized context, genuine repository/deployment pin, verified actual purpose/use/data/territory/sharing and safeguards, with unknowns preserved. All 243 rules still require current validated decisions, no open human blocker and a successful Completion Gate before the native Root may submit a report. No candidate with those verified facts has been supplied. [Minimum conditions, proposed scenario rejection and capture plan](report-closure-20261029/report-closure-scenario-eligibility.md).

**Project-owner decision required, not granted:** retain the fresh-report condition and provide verified context for an actual owned controlled deployment, or explicitly accept the named alternative evidence (native production concurrency/control proof + real API/DB/scripted report contracts + existing-report preservation) while recording that fresh actual production completion remains unproven and why the residual risk is accepted. Any alternative must be attributed/dated in Jira and this PR before changing the gate. It cannot waive required independent approval. The pending question, green CI and elapsed time are not acceptance.

On the new build, the existing completed grading artifact `56c3c8c6-b697-51ff-abff-cb79ff352401` still renders/downloads: **243 findings, 1,580,143 bytes**, SHA-256 **`b1a8fe7b01371c8c42b97f74f2b09f7402b4b6f42882de9e18421a6c8dc8fdd9`**, unchanged pins, foreign download 404. This is preservation/read compatibility, not fresh generation or legal certification. [Report check](recovery-44dba336f/recovery-preserved-report-and-browser-timeline.json), [243 rendered DOM findings](recovery-44dba336f/recovery-rendered-report-verification.json). The initial screenshot caught loading; [that attempt is retained](recovery-44dba336f/screenshots/recovery-report-loading-attempt.png), and the report screenshot below was recaptured after render verification.

Fresh screenshots: [A active](recovery-44dba336f/screenshots/recovery-A-concurrent.png), [B active](recovery-44dba336f/screenshots/recovery-B-concurrent.png), [A paused](recovery-44dba336f/screenshots/recovery-A-paused.png), [B continuing](recovery-44dba336f/screenshots/recovery-B-while-A-paused.png), [A human checkpoint](recovery-44dba336f/screenshots/recovery-A-human-unknown.png), [B human checkpoint](recovery-44dba336f/screenshots/recovery-B-human-unknown.png), [preserved report](recovery-44dba336f/screenshots/recovery-preserved-completed-report.png).

[Deployment screenshot](recovery-44dba336f/screenshots/recovery-deployment-evidence.png) is explicitly a **static operator view of read-only observations**, not a live application dashboard; [HTML](recovery-44dba336f/recovery-deployment-evidence.html). The [checker](recovery-44dba336f/verify_recovery_evidence.py) verifies overlap, cap, queue/handoff, ancestry, absence of paused writes, account/pin isolation, attempts, callbacks, prices, UI totals and CI SHA. No prompt, hidden reasoning, credential, customer dataset or full private report body is published.

## K. Release verdict and LCSP-364 handoff

| Gate                        | Result  | Evidence / limit                                                                                                                                  |
| --------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| IMPLEMENTATION              | PASS    | Original bounded architecture retained; semantic/replay and pricing defects repaired                                                              |
| AUTOMATED_TESTS             | PASS    | Focused/broad tests, broker and actual API/DB/native verticals; explicit skips/setup history                                                      |
| PR_CI                       | PASS    | Exact HEAD, 36 successful checks; normal review still required                                                                                    |
| PRODUCTION_DEPLOYMENT       | PASS    | Exact checkout/image/source, actual rebuild, health 200                                                                                           |
| REAL_CONCURRENCY            | PASS    | 194.436 s Root overlap, 8.351 s model overlap, cap two and third-case handoff                                                                     |
| STOP_CONTINUE               | PASS    | A Stop/B progress/canonical resume; no paused accepted writes                                                                                     |
| HITL_CHECKPOINT_CORRECTNESS | PASS    | Real unknown-answer receipts; live same-checkpoint additional-fact fixture                                                                        |
| STREAM_ISOLATION            | PASS    | Interleaved identities, browser refresh, foreign timeline denial; no fresh active SSE network capture                                             |
| USAGE_TOKEN_RECONCILIATION  | PASS    | 65 attempts/130 callbacks; customer totals match; missing provider usage explicit                                                                 |
| MONETARY_ROUTE_ACCOUNTING   | PASS    | Published route/version, 64 exact estimates; failed-attempt UNKNOWN/partial aggregate under existing contract; no invoice/actual-charge PASS      |
| LEGAL_SEMANTICS_REGRESSION  | PASS    | Six captured-packet controls, six live unknown controls, six positive controls and native resume; fresh production accepts no unsupported verdict |
| REPORT_LIFECYCLE            | BLOCKED | Contracts/read preservation pass; fresh production report creation remains unexecuted                                                             |
| SECURITY_FOLLOW_UP          | PASS    | Affected local credential rotated, old rejected, no production match                                                                              |
| SCOPE_PRESERVATION          | PASS    | Research one/full pinned set; no LCSP-345/347/364 implementation or historical rewrite                                                            |
| REVIEW_APPROVAL             | BLOCKED | One required approval, zero received; current reviewer request remains pending                                                                    |
| PR_MERGED                   | BLOCKED | PR is open/unmerged; normal protected merge cannot proceed                                                                                        |
| FINAL_MERGED_DEPLOYMENT     | BLOCKED | Not executed because no merge/release has been approved                                                                                           |
| OVERALL                     | BLOCKED | Fresh-report acceptance unexecuted and normal approval/merge outstanding                                                                          |

Request normal review of this implementation and explicit release disposition. Do not merge automatically or transition Jira to Done. Replacing the original fresh-report requirement with a legitimate human-wait outcome requires an explicit acceptance decision; this report does not weaken it.

LCSP-364 handoff: [bounded concurrency documentation](https://github.com/khov4nfs/LCSP/blob/44dba336f332d566d3fee9fc0d32642a402d024e/docs/developer/bounded-assessment-concurrency.md) covers fixed capacity, API lease/admission, broker/server/replica limits, available/missing metrics, host observations, provider/DB constraints and reusable fixtures. Sandbox **2 GiB each** is a configured limit, not measured per-Root RSS. LCSP-364 remains separate and dependent on LCSP-346; autoscaling was not implemented.
