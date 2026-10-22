# LCSP-360 final acceptance and release report (2026-10-21)

**BLOCKED_EXTERNAL_CONTRACT_EVIDENCE — no authorized account contracts are available.** Public provider and actual local credential/SDK topology verification is complete; zero production policies or routes are eligible. The atomic admission source remains `1ed318e4257d93b7ea89973832afedad766a036a`, published at `090775bb763b8bbcf43d524050b03de4424755fe` with all 38 checks passing. See section 18 for new evidence and remaining deadline/resource prerequisites. Historical sections 12–17 are preserved. No paid inference; PR remains Draft.

- Current accounting candidate: `9cf033e099225300ffe98247eb3717e254a79232` (section 12).

- Code candidate after recovery: `4ba42c7bf7c756d552088569772e8c1f1fef8fd0`.
- Recovery commits: `7f101575b` (Prisma CI URL), `7577a820e` (security patches), `4ba42c7bf` (claim-first fixture journey).

- Draft PR: https://github.com/khov4nfs/LCSP/pull/427 (base `develop`)
- Live-evaluated candidate: `f331a13cd`. The PR head is that candidate plus later CI, staging and security commits, listed below.
- Pre-change snapshots:
  - `refs/lcsp360/pre-final-20261021T154849` (pre-final pass)
  - `refs/lcsp360/final-candidate-*` (frozen candidate)

## 1. Root causes fixed in this pass

| Area | Root cause | Fix | Proof |
|---|---|---|---|
| `test_exact_94773fa8` and graph v1→v2 | After the `legal-structure-v2` bump, every run-scoped graph read served only the current parser revision. A run pinned to a v1 materialization therefore failed in several places: a raw 500 on NEXT, STALE after worker takeover, a materialization mismatch at freeze/validate/submit, and a reopened inventory revision that split onto the v2 graph. | A run reads the materialization its first review frontier pinned. That row is FK-restricted, so it is never deleted. Only a run with no frontier yet materializes the current revision. | The retained v1 replay passes with its test and fixture unchanged. A new API takeover test fails on each pre-fix handler. |
| Cross-unit relation with no structural reference | Two problems. A freeze-time audit fault on another unit's relation told the model to reopen the audited unit, which cannot change that relation. Once that unit was active it could not defer at all (deferral needs one of its own references), so the run ended in NoProgress. | A freeze-time fault names the relation's owner and says not to reopen the audited unit. A yield with no references now waits for the reopened owner (`payload.blockedSourceNodeIds`); migration `20261021190000` relaxes the blocked-row CHECK only for that shape. The unit wakes when the owner recommits. | 4 real-handler regressions. The two negative controls, where the reversed relation is re-added, still fail. |
| Nara (user request) | Unused provider preset with its own credential pool. | Removed everywhere: code, tests, docs and env templates. | No Nara references remain in HEAD. |
| Clean-checkout CI | Several Python tests read retained artifacts that existed only in the local, untracked `reports/`. CI failed at collection. | Committed the retained inputs. The oracle moved to `deepagents/tests/fixtures`. | A clean worktree runs the suite like CI: 1873 passed, 63 skipped, 0 failed. |
| API unit ordering | In CI's size-ordered single-worker run, billing suites `db push` the shared database, which drops the migration's deferrable FK. Graph-materializing suites that ran after them failed. | Those suites restore the migrated schema first when it is missing. | A push suite followed by the claim-inventory suite passes. The full suite in CI order: 1394 passed. |
| Develop merge | `response-transform` pointed at the route named `fallback`, which is a different model on this branch. The localization test opened a human request without an anchor. | Map `response-transform` to Gemini flash-lite, as develop intended. Anchor the test's request. | Provider and localization suites pass. |
| Deploy wiring | The Mirai key and the audit-attestation key were not forwarded to the docker dev worker or to staging. The attestation key was undocumented, and preparation fails closed without it. CI's agent-import check had no Mirai key. | Forward and generate both keys; document the attestation key. Add a placeholder key to CI. | Dev-scripts 14/14 and staging 9/9 pass. The import fails without the key and passes with it. |
| Release preflight | Seven active uses of retired vocabulary. | Reworded them. | Terminology check PASS (0 defects). |
| Admin Prepare e2e | Prepare now sends the on-screen version id, but the spec still asserted an empty body. | The spec asserts the body. | Playwright 20/20. |
| CodeQL | Four critical "type confusion" findings on `.length` of the upload body. The body has already passed `Buffer.isBuffer`. | Use `byteLength`, which is identical for a Buffer. | Legal-source suites pass. |

## 2. Pre-recovery retained gate results (not rerun here)

| Gate | Result |
|---|---|
| Python, main tree (frontier DB) | 1928 passed, 8 skipped |
| Python, clean checkout as in CI | 1873 passed, 63 skipped |
| API compliance-rule-set + legal-source | 452 passed, plus 69 in their four isolated-DB suites |
| API full unit, CI order, fresh migrated DB | 1394 passed, 0 failed |
| API e2e (security, PBAC, tenant isolation) | 157 passed, 0 failed |
| Static: typecheck, imports, contracts, legal-v1-retired, billing gate, dev-scripts, literal-answer | all pass |
| Web: unit tests, lint, production build | 329 + 31 tests pass; lint and build pass |
| Playwright admin + billing | 20/20 |
| Canonical terminology | PASS |
| Docker sandbox E2E | GitHub PASS on `7f101575b`; latest-code CI PASS on `4ba42c7bf`. Local historical run passed four rootfs audits, then failed candidate-source stability; it is not a Docker integration PASS. |
| Assessment Root vertical (local provider-free protocol) | **PASS**: Compliance 77, Root 145, HITL 79, unresolvable 72; see recovery evidence below |
| `git diff --check` over the PR | clean; no secret patterns and no configured key values in the diff |

## 3. Existing live run recovered without restart

- Evaluated SHA: `f331a13cdf473d47d66c7efeab2c418153c63213`.
- Run: `7a91def1-8baf-44a0-81a4-15c9fbc4b0c6`; disposable database `lcsp_compliance_rule_set_live` on loopback port 55441.
- Started 2026-10-21 11:48:02 UTC; final harness evidence 12:48:14 UTC.
- Both handoff processes (755962/756551) had exited before recovery. No evaluation was started, restarted, terminated or duplicated during recovery. Its database was not reset or manually repaired.
- Harness terminal: `RUN_ABORTED`, `live run exceeded 3600000 ms`. The retained database still says `RUNNING` / `CLAIM_DISCOVERY`; this is an abandoned execution, not a successful terminal.
- Last frontier: 12 units, 11 committed, 1 in review, 19 persisted claims, 12 audit receipts. No frozen inventory, no LegalRequirements/AssessmentRules, no Rule Set version and no activation exist for this run. Rule Set version: **none**; activation: **not reached**.
- Trace: 164 model-start events, 157 model completions, 7 model errors. These callback counts are not a canonical provider-call or billing total. Last event is a provider `RemoteProtocolError`.
- Token totals/model usage: **UNAVAILABLE**. The worker's usage file was never written before harness timeout and this disposable database contains zero usage rows. Do not interpret null as zero usage. The configured primary route was Mirai `claude-sonnet-5`; successful provider identities per completion were not retained in this trace.

**Root cause:** The only freeze attempt rejected all 19 claims with `UNDETERMINED_SOURCE_STATUS`. The shared disposable seeder wrote legacy `legalStatus='IN_FORCE'` but omitted canonical `legalEffectStatus` and `legalStatusSourceRef`. All 20 pinned graph nodes consequently had UNKNOWN authority. This deterministic fixture defect prevented freeze regardless of subsequent model repair. Other semantic rejections and network errors remain in the trace; correcting this fixture does not establish live legal acceptance.

**Fix:** Future disposable sources now record canonical EFFECTIVE chunk status and an explicit `fixture:<name>` provenance reference. The immutable failed run, its source pin and its receipts remain unchanged. No law interpretation, audit verdict or acceptance validator was weakened. The live verification query also uses the actual `LegalRequirementClaimBinding.legalRequirementRowId` persistence column.

Independent live-artifact probe: **FAIL as expected**. Twelve receipts verify under HMAC and reject tampering/wrong-run reuse; the pin is consistent. Freeze, source-support verification against a frozen graph, persistence and activation are not proven. The API smoke now selects the specified evaluated run and reports a structured missing-ACTIVE prerequisite; downstream visibility/authentication/isolation/pinning checks are **BLOCKED**, not passed against some other version.

Evidence: `live-run/live-eval-synthetic.*`, `live-run/persisted-snapshot.json`, `live-run/recovery-summary.json`, `live-run/independent-artifact-verification.json`, `live-run/api-smoke.json`.

## 4. Assessment Root gate repair

**Root cause:** The provider-free CLI submitted legacy hand-written packets before discovery/freeze. Root and human-resolution fixtures also assumed criterion `C-1`, whereas typed authoring derives immutable criterion IDs and requires explicit applicability basis.

**Fix:** The scripted model now leases source units, registers supported claims and scope relations, completes independently fixture-audited review, freezes through the real API, calls both typed authoring tools, validates and submits. The mechanical fixture auditor is explicitly test-only; the API still verifies receipts, inventory integrity, provenance, Validator results and atomic activation. Unknown parents, corrupt source-support hashes, inconsistent source pins, duplicate runs and failed submissions remain negative controls. Root reads criterion IDs from its pinned Rule Set and submits applicability findings. Ownership fixtures explicitly retain repository-observable and external aspects under MIXED assessability.

Local verification:

- Compliance Rule Set vertical: **77 checks PASS**, including real freeze and both typed authoring tools.
- Assessment Root vertical: **145 checks PASS**, including rejected decision correction, tenant/pin checks and deletion.
- HITL: **79 checks PASS**; unresolvable human fact: **72 checks PASS**, with separate-process PostgresSaver/crash recovery.
- All eight dependent Root fixture Preparations: **SUCCEEDED**, zero provider calls (scripted Producer/auditor).
- Existing artifact verifier on the provider-free fallback fixture: all **15 checks PASS** through freeze → Requirements → Rules → Validator → PostgreSQL → activation. This result is explicitly **not live semantic acceptance**.
- Governance/security regressions: **110 passed**; semantic-auditor/fidelity regressions: **80 passed**. Final standalone governance repeat: **10 passed**.
- The old packet-only offline governance unit now verifies the source-blocked provider-free branch; the successful claim-first journey is covered by the real-stack vertical above.

An intermediate local run conflicted because Root/HITL share a disposable database name; another overlapped dependency synchronization. Those failed attempts are not acceptance receipts. The successful Root run was executed sequentially after synchronization. The preserved live database was unaffected.

## 5. Python CI and security

Latest-head failure at takeover was **not** missing Node/pnpm: those tools were already installed by `fd652b182`. Prisma generation failed because `DATABASE_URL` was absent. Recovery supplies a generation-only disposable URL in both Python jobs. Local generation passed. GitHub Python worker tests and both Python checks subsequently **passed on `7f101575b`**. Final-code CI is tracked separately below.

Trivy baseline comparison: both `origin/develop` and takeover HEAD locked aiohttp 3.14.3 and certifi 2026.7.22. These are genuine baseline vulnerabilities, not false positives. The recovery lock updates aiohttp to 3.14.5, certifi to 2026.10.19 and yarl to 1.25.1. `uv lock --check` and focused tests pass. Advisory sources: https://github.com/advisories/GHSA-6q48-6c7w-9gw2 and https://github.com/advisories/GHSA-2g87-pp6c-29x5.

Security alert triage (no policy exclusions or severity reductions):

- Trustabl #75: false positive; `StructuredTool.from_function(..., description=description)` explicitly supplies every tool description.
- Trustabl #38, #41–46, #49–52, #76–77: intentional provider-free test fixtures (malformed-call sentinels/short tools/dynamic configuration); dismissed as **used in tests**, with per-alert explanations.
- Trivy #73/#74: retained historical one-shot firewall image, used only by `isolate-runtime.py` with NET_ADMIN/root to install iptables rules. No persistent service exists to health-check. Dismissed as **used in tests**; original evidence Dockerfile preserved.
- Other pre-existing root-user/health-check Dockerfile findings remain visible and are not claimed fixed by this work.

Evidence: `security/alerts-before.json`, `security/triage-decisions.json`, final CI snapshot. GitHub's passing scanner execution alone is not sufficient; the separate code-scanning policy checks must also pass.

## 6. Docker and staging boundary

The historical local image run `reports/release-images/20261021120745_54c5e7380280/report.json` passed all four merged-rootfs audits, then failed **candidate source stability** after concurrent edits. It never reached a valid seven-integration receipt. GitHub Docker sandbox E2E passed on takeover HEAD and on `7f101575b`; final-code evidence is recorded below. No unnecessary local rebuild was launched while disk remained 97% full (16 GB available).

Staging image/browser verification has **not run for the recovered candidate**. The subsequently authorized single fresh evaluation is conditional on passing preflight; it was not dispatched because durable token accounting fails (section 11). Existing images cannot establish staging acceptance for a changed candidate. No production merge/deployment occurred.

## 7. Remaining release blockers

0. First current failed gate: the shared disposable seeder writes a fixture-name hash into `LegalSourceDocument.sourceSha256` instead of the verified source-byte digest (section 15). Prior chunk/support/hash checks did not prove this document binding. Repair and a focused regression/preflight are required before any model dispatch.
1. The original live evaluation timed out before freeze and activation. The canonical-effect seeder defect, durable-accounting blocker and latest security blocker are fixed. Real-model semantic/runtime acceptance remains unproven. No approved spending ceiling or shared pre-dispatch budget enforcement exists; the latest instruction permits non-paid readiness only until those prerequisites pass.
2. After separately authorized semantic/runtime acceptance passes, build stable release images and complete disposable staging/browser verification with the repository tooling. The dependency-image checks in section 14 do not substitute for that acceptance. Do not use production secrets.
3. Token usage for the aborted run cannot be recovered from the retained artifacts. Canonical usage remains unavailable; do not invent totals.

## 8. Staging verification (prepared, not executed)

Prerequisites:
- Staging and production `.env` need `MIRAI_API_KEY` and a 64-hex `LCSP_SEMANTIC_AUDIT_ATTESTATION_KEY`, shared by the API and the worker.
- Apply the migrations `20261020140000` and `20261021190000`.

Steps:
1. `python tests/release-images.py` on the authorized frozen candidate. This builds the accepted candidate images and writes their evidence to `reports/release-images/<id>`.
2. `python tests/staging-stack.py --image-evidence reports/release-images/<id>` starts a disposable staging run. The stack now generates its own attestation key.
3. `node tests/staging-browser-flow.mjs <runId> <phase>` for each browser phase: admin activates a Legal Source, the automatic preparation runs, the Rule Set becomes visible, and a customer runs an assessment.
4. Verify the persisted artifacts with `probes/verify_live_artifacts.py`, pointed at the staging database.
5. `python tests/staging-stack.py --stop <runId>`.

In-flight `legal-structure-v1` preparations keep their pinned graph after deploy; new runs materialize v2.

## 9. Evidence

Everything below is under `reports/lcsp360-final-release-20261021/final-acceptance/`:
- `01-pinned-graph-and-unreferenced-recovery.md`
- `live-run/`: candidate, progress, trace, harness JSON
- `probes/`: artifact verifier, API smoke, primary-route probe
- this report

## 10. Final code CI receipt

Code candidate: `4ba42c7bf7c756d552088569772e8c1f1fef8fd0`.

**All 41 GitHub checks passed**, including the V2 required release gate, Assessment Root vertical, Python worker tests/checks, Docker sandbox E2E, API unit/e2e/coverage, workspace/static and web checks, Playwright, CodeQL, Trivy and Trustabl policy checks. Exact check IDs, links, head SHAs and the retrieval timestamp are retained in `ci-latest.json`. Tests workflow: https://github.com/khov4nfs/LCSP/actions/runs/39606632811.

This closes the CI/security and provider-free integration blockers. It does not close the live semantic/runtime or staging/browser blockers. Status remains **BLOCKED**; PR #427 remains Draft.

Docker receipt: `docker-ci/receipt.json`, verified artifact ZIP SHA-256 `6c64531410f0f832cf9512b488467ac656f664edb4970f05346e6b89ce0e3f1a`. The selected 2026-10-21 manifest/report proves four rootfs audits and seven integrations on the code candidate; historical reports in the same GitHub artifact were excluded from this conclusion.

## 11. Final real-model acceptance preflight — stopped before dispatch

Requested candidate: `3768b9abf01faf447d3a12c99f4028796cf5ce24`; local HEAD and Draft PR head matched. Runtime source files were not modified. The new authorization permits one isolated bounded evaluation only after preflight passes and requires stopping at the first verified failure.

**Root cause:** Durable token accounting fails. In `deepagents/tests/vertical/live_preparation.py:105`, `on_llm_end` writes a completion count to the trace but accumulates provider token numbers only in memory. The usage file is written at line 126, after `run_rule_set_preparation` returns. This standalone entry point and its runner do not activate the canonical metering state or an agent-stream session. The metering context defaults to None, and stream publication returns without a session. An interrupted evaluation therefore has no durable usage record to recover. This is corroborated by the retained actual timeout: 157 completion callbacks, no recovered usage rows and unavailable token totals. It is independent of the repaired source-effect seeder.

**Fix required, not implemented:** Persist provider-response usage incrementally with run and invocation attribution, covering every model used by preparation and auditing. Verify interruption/recovery without paid calls before repeating the complete preflight. Runtime changes and another evaluation were not attempted after this failure, as instructed.

| Preflight or acceptance gate | Result for this attempt |
|---|---|
| Candidate identity | PASS: exact requested local/PR SHA |
| Canonical source-effect metadata | Source inspection only: EFFECTIVE and fixture provenance present in the seeder; no new database materialization |
| Durable token accounting | **FAIL**: first verified preflight blocker |
| Provider quota and HMAC configuration | NOT_CHECKED after preflight failure |
| Database isolation and materialized source provenance | NOT_PROVISIONED / NOT_VERIFIED; no database created, reset or repaired |
| Fresh real-model evaluation | NOT_STARTED; run ID: none; new provider calls: **0**; new input/output tokens: **0/0** |
| Freeze → Requirements → Rules → Validator → PostgreSQL → activation | NOT_EVALUATED for the requested real-model candidate; Rule Set version: none; activation: not reached |
| Independent semantics, hashes, receipts, API and tenant isolation | NOT_EVALUATED for a fresh real-model run |
| CI/security on requested candidate | Retained exact-head receipt: **39 checks PASS**, including V2, Root, Docker and separate scanner policies; no matrix rerun |
| Release-image, staging and browser acceptance | NOT_RUN after failed preflight |

Zero new calls/tokens means no dispatch in this attempt; historical aborted-run token totals remain **unknown**, not zero. Disk was 97% full with 16 GB available. All three protected WIP files retained their SHA-256 values. No old evidence/database, runtime dependency, production deployment or merge was changed.

Evidence: `final-real-model-preflight/preflight.json` (timestamp, exact candidate/source hashes, static assertions, prior-timeout corroboration and protected WIP hashes), `final-real-model-preflight/ci-candidate.json` (39 checks with exact head IDs/links, originally retrieved 2026-10-21 13:44 UTC). This is a preflight failure receipt, not a real-model acceptance receipt.

## 12. Durable usage repair and non-paid preflight

Candidate: `9cf033e099225300ffe98247eb3717e254a79232`. **PREFLIGHT_READY for the non-paid checks below; release remains BLOCKED.** Section 11 preserves the failure at the earlier candidate and is superseded by this repair. No paid evaluation, staging, browser flow or deployment was authorized or executed in this pass.

**Root cause:** Producer CLI callbacks were neither invocation-idempotent nor a complete observation point for the independently resolved Auditor model. Token totals existed only in memory until normal return. The timeout race also left the worker alive while the harness sampled evidence.

**Fix:** The CLI activates the existing run-scoped metering port and records each raw answered invocation before semantic/schema rejection can trigger retry or fallback. Producer, reader, summarization and independently resolved Auditor work inherit that context. SDK internal retries remain disabled by the existing provider configuration (Gemini uses one attempt). Failed attempts without provider usage are not assigned invented tokens.

The existing SQLite recovery store now supports retained RECORDED evidence, separate from pending assessment callbacks. Each `(run, invocation)` key commits atomically with WAL/FULL synchronization; duplicate delivery retains the first committed record. The archive preserves provider/model/role identity, reported usage/cache buckets and unavailable usage explicitly. It is not attributed to a fabricated customer assessment and is never drained as a billing callback. Storage failure stops without retrying the answered model.

The CLI's adjacent `usage.json.sqlite3` is authoritative. Recovery reads committed rows without replay, rejects another run's archive and atomically replaces the derived JSON snapshot. Canonical input tokens exclude separately reported cache buckets. Aggregate dimensions become null when some invocation did not report them; known subtotals and raw numeric reported dimensions remain available per invocation. Coverage is explicitly **completed provider responses only**; usage of an unanswered/in-flight request remains unknown.

The live harness retains its archive under the evidence directory, applies the execution deadline to the worker process, waits for worker exit, then runs the recovery-only CLI before writing its terminal report. Missing/corrupt accounting cannot produce a passing evaluation exit code. No historical evaluation process or database was changed.

Verification:

- Focused Python metering/telemetry, fallback and Preparation-governance suites: **153 passed**. The final accounting-only check after reporting refinements: **10 passed**. Includes real provider-free Producer and independent Auditor graphs, same-provider rejected-answer resampling, successful/failed fallback, duplicate records, missing/partial usage, foreign-run rejection and storage failure.
- Crash (`os._exit`), SIGTERM and SIGKILL retain both committed Producer/Auditor records. The Node harness timeout test passed and recovered exactly **2 completed fixture invocations, 18 input / 8 output tokens**, with idempotent recovery.
- Reconciliation fixture: **6 duplicate record attempts → 3 unique invocations; 21 uncached input + 6 cache-read + 3 cache-write = 30 reported input; 9 output**. These are synthetic usage records, with **zero provider calls**.
- Import policy, JavaScript syntax, canonical terminology and whitespace checks passed. AST graph update completed without LLM calls; the optional HTML view could not regenerate at its existing graph-size limit.

Non-paid preflight:

| Gate | Evidence/result |
|---|---|
| Exact candidate identity | Local and Draft PR head `9cf033e09`; source hashes retained |
| Database isolation | New loopback container on **55501**, database `lcsp360_usage_preflight_ef1ced5f65ff`; historical **55441** untouched. Diagnostic API stopped, then the owned ephemeral container stopped |
| Canonical effect and provenance | **15 chunks**, fixture provenance refs and independent content hashes; **20 EFFECTIVE graph nodes**, **18 support hashes** recomputed |
| Source pin | Version `70a43f56-31ec-4eb4-83d6-759f1584201f`; materialization `3b8d5d6a637859493767885aaa41cafcf9e4300826a8d9a47c4f4cc3465e847b` |
| HMAC and authentication | Random ephemeral key shared by diagnostic API/worker, Python and independent Node verification; tamper/wrong-run rejection; missing worker key rejected. Only the key fingerprint is retained |
| Primary provider availability | Read-only Mirai quota API returned HTTP 200, active expiry and **4,692,038 quota units remaining**. Official catalog advertises `claude-sonnet-5`, selected by both Producer and Auditor |
| Fallback configuration | Credential pools present for every configured route; provider-free credential rotation, fallback and usage tests pass. **Fallback balances and live provider behavior are not verified** |
| Durable usage | Atomic, invocation-idempotent, cache-preserving interruption/recovery checks above pass |

Quota is point-in-time availability, not a guarantee of model liveness or sufficient budget for a complete evaluation. The quota endpoint is linked from the provider's official usage page: https://miraiapi.com/usage/. No completion/inference endpoint was called.

Diagnostic Preparation row `bcc4449a-945f-4362-a68e-14b548fcc146` was used only to read the pinned bundle. It is **not** a real-model evaluation run: zero semantic-audit rows and zero Rule Set versions; no freeze, semantic verdict or activation is claimed. Fresh real-model run ID: **none**; paid model calls/tokens this pass: **0**. Historical aborted-run usage remains unavailable.

CI/security workflows for `9cf033e09` are in progress at evidence capture; the 39 passing checks on `3768b9abf` are retained historical evidence, not current-head proof. No smoke matrix or manual CI rerun was launched. PR remains Draft.

Evidence directory: `durable-token-accounting/`. `preflight-summary.json` pins source/WIP hashes and limitations; source/HMAC/database, provider quota/catalog and reconciliation receipts are separate JSONs. Focused JUnit reports, timeout output, replayable non-paid probe sources and the synthetic usage snapshot are retained. All protected WIP hashes match the prior receipt. Release still requires current CI/security, separately authorized real-model acceptance and subsequent release-image/staging/browser acceptance.

## 13. Final acceptance attempt, 2026-10-22 — security preflight stopped

Takeover HEAD: `73018c13527593207f209775ba48abefec008ee0`. Security-fix candidate: `bca42bfe7a109f30f7014e5eac11237617692a6a`. The user authorized one bounded real-model evaluation only after all gates pass, and required stopping at the first preflight/acceptance failure. **No candidate was frozen for evaluation and no model was dispatched.**

**Root cause — Trustabl (fixed):** Alert [#82](https://github.com/khov4nfs/LCSP/security/code-scanning/82), LC-019, identified the 27-character description on `fixture_tool` in `test_live_preparation_usage.py`. This new resampling fixture omitted its input/output contract from the description. All other 36 checks passed at takeover, including the scanner job; the separate `trustabl` policy check correctly failed.

**Fix:** The fixture description now states its integer input, string result and provider-free resampling purpose. The affected regression passed (**1 test**). No production semantics, security configuration or alert dismissal changed. On `bca42bfe7`, the `trustabl` policy check [119625733067](https://github.com/khov4nfs/LCSP/runs/119625733067) passed; the PR instance of #82 is fixed.

**Root cause — first subsequent gate failure (unfixed):** Trivy policy check [119625693303](https://github.com/khov4nfs/LCSP/runs/119625693303) flags [alert #85](https://github.com/khov4nfs/LCSP/security/code-scanning/85): `deepagents/uv.lock` selects `pypdf 6.20.1`, within CVE-2026-113786's affected range `<6.21.1`. The upstream [maintainer advisory](https://github.com/py-pdf/pypdf/security/advisories/GHSA-5hx5-vpf9-5wcv) confirms the image-parser selection issue and fix in `6.21.1`. The existing project constraint `pypdf>=5,<7` permits that patched version; the lock has not been updated.

Baseline and applicability: pypdf is absent from the PR base `597f9c72212d5676326e56598e1982319ae1d600`, so this dependency is introduced by the overall PR. Version `6.20.1` was already present in takeover HEAD `73018c135`; the Trustabl description fix did not change the lock. The advisory requires loading image data through optional Pillow. Pillow is absent from the current lock and local Python environment. Release-image applicability was not inspected after this failed gate; no blanket claim of runtime exploitability or non-exploitability is made. The package-version finding remains open; no policy exclusion, severity reduction or dismissal was applied.

**Fix required, not executed under the stop instruction:** Resolve pypdf to a patched version, run focused PDF extraction regressions, and obtain passing required checks on the resulting exact HEAD before repeating preflight. No dependency change, paid evaluation or automatic paid retry followed this failure.

Other observations before stopping:

- Candidate API build passed. The durable-accounting runtime and recovery/harness sources match the prior verified hashes; the only accounting-test change is the fixture description. The protected historical report JSONs and orphan-reconciliation spec retain their hashes.
- Read-only primary-provider readiness passed: configured Producer/Auditor model advertised, unexpired Mirai key, **4,692,038 quota units remaining**. Configured fallback credentials are present; balances/live-provider behavior remain unverified. No inference endpoint was called.
- A fresh PostgreSQL container was prepared on loopback **55502**, then stopped after the CI failure. No source or evaluation database was seeded there. Historical **55441** and its evidence were untouched. An unused random HMAC key remains in a private mode-0600 temporary runtime file; no key value is published.
- Fresh source/HMAC/database preflight execution, real-model workflow/semantics/artifact/API/tenant verification, release-image, staging and browser acceptance were **NOT_RUN** after failure. Rule Set version: **none**; activation: **not reached**; fresh real-model run ID: **none**; new provider calls/tokens: **0**. Historical paid usage remains unavailable.
- Other current-candidate CI jobs were still running at capture; their eventual success cannot override the failing Trivy policy. No broad local suite or manual CI rerun was launched.

Evidence: `release-20261022/security-takeover.json`, `blocker-summary.json` (exact check IDs/SHAs, baseline and applicability, source/WIP hashes, stop boundary), `upstream-advisory.json`, `provider-readiness.json`, `api-build.log`. Prepared non-paid probe sources are retained but were not executed. PR #427 remains Draft. Status: **BLOCKED**.

## 14. Trivy dependency repair and non-paid runtime preflight, 2026-10-22

Takeover HEAD: `8c6cbd07a12edfc181d28fae8bc6f6ffdbced9cc`. Verified runtime candidate and dependency-fix commit: **`6baf188379b9f4beb119216f709504226d298ecd`**. **PREFLIGHT_READY for non-paid checks; release remains BLOCKED.** This section supersedes the unresolved security blocker in section 13. The current instruction explicitly stops before paid evaluation.

**Root cause:** `uv.lock` selected vulnerable `pypdf 6.20.1`, while `pypdf>=5,<7` also allowed production pip installs to select affected releases. Updating only the lock would not protect `deepagents/Dockerfile`, which installs `/app/deepagents` with pip.

**Fix:** Require **`pypdf>=6.21.1,<7`** in `deepagents/pyproject.toml`; regenerate with `uv lock --upgrade-package pypdf==6.21.1` (uv 0.11.26). Only pypdf changes version in the lock, from 6.20.1 to 6.21.1. No Dockerfile, accounting, semantic validation, audit, policy exclusion or advisory dismissal changed. Both pip and uv receive the patched minimum from the project metadata.

| Gate | Verified result |
|---|---|
| Lock consistency | `uv lock --check` and `uv sync --frozen --extra dev` pass; local installed pypdf 6.21.1 |
| Focused PDF regressions | **159 passed, zero failures/errors/skips**, covering managed ingestion/representation, official extraction/repository/consumer, legal-source ingestion/provenance and OCR PDF fixtures. Provider-free tests include corrupt/empty PDF controls |
| Production pip worker | Clean `deepagents/Dockerfile` build passes; actual installed **pypdf 6.21.2**, `/usr/local/lib/python3.11/site-packages/pypdf`. `python -m pip check` passes |
| Production uv Agent Server | Clean `deepagents-langgraph/Dockerfile` build passes; actual installed **pypdf 6.21.1**, `/app/deepagents/.venv/lib/python3.11/site-packages/pypdf`. `uv pip check` passes for 175 packages |
| Installed dependency contract | Both images expose `pypdf<7,>=6.21.1` in installed `lcsp-agent-runtime` metadata; assertions reject 6.20.1 and 7.0.0 and accept the actual patched version |
| Image PDF check | Both actual images import pypdf and write/read a one-page PDF, with **network disabled**, read-only rootfs and no provider credentials |
| Required CI/security | **All 36 checks pass on exact SHA `6baf188379b9`**, including V2 required release gate, Assessment Root vertical, Docker sandbox E2E, API/Python/web/Playwright gates, Dependency Review and separate Trivy/Trustabl/CodeQL policies |
| Trivy finding | [Alert #85](https://github.com/khov4nfs/LCSP/security/code-scanning/85) is **fixed** on the PR merge ref; dismissal fields are null. [Trivy policy passes](https://github.com/khov4nfs/LCSP/runs/119638031303), as do [Trustabl](https://github.com/khov4nfs/LCSP/runs/119638123265) and [CodeQL](https://github.com/khov4nfs/LCSP/runs/119638095804) |
| Source provenance | Fresh disposable database: **15 canonical EFFECTIVE chunks**, fixture provenance and content hashes; **20 EFFECTIVE graph nodes**, **18 independently recomputed source-support hashes** |
| HMAC/authentication | Ephemeral random key shared by diagnostic API/worker; Python and independent Node verification pass; tamper, wrong-run and missing-worker-key controls reject. Only fingerprint/signature evidence is retained |
| Database isolation | New database `lcsp360_pypdf_preflight_7a3088043efe` on owned loopback **55502**; diagnostic API and container stopped afterward. Historical **55441** untouched |
| Provider readiness | Read-only quota/catalog checks pass: primary Producer/Auditor model advertised, key unexpired, **4,692,038 quota units remaining**. Configured fallback credentials present; fallback balances/live behavior unverified |
| Accounting/semantic preservation | Runtime/recovery/harness source hashes match the verified accounting candidate. The sole accounting-fixture difference is the prior Trustabl docstring repair. Current Python CI passes; prior interruption/reconciliation evidence in section 12 is retained |
| WIP preservation | All three protected WIP files retain their recorded SHA-256 values; none is committed in this change |

Images were built from a **clean `git archive` of the committed candidate**, with revision labels and hashed Dockerfiles/manifests; dirty WIP, `.env`, local virtual environments and historical reports were excluded. Exact image IDs, paths and installed metadata are in `docker-worker-runtime.json` and `docker-server-runtime.json`. Pip resolves independently of uv.lock, hence 6.21.2 versus the server's locked 6.21.1; both satisfy the patched floor. These are dependency/runtime checks, not a blanket image-vulnerability or staging acceptance claim.

The first server dependency diagnostic could not create uv's cache on the read-only rootfs. That diagnostic failure is preserved. Providing only a temporary tmpfs cache, with network still disabled and the image still read-only, permits the check; all installed packages are compatible. No production image or gate was changed to accommodate the diagnostic.

Provider-free diagnostic run: **`ed72c8ae-86a8-480c-afa2-1b9a5590855c`**, source version **`6887d934-139f-4e16-8a05-c5f897a57661`**, materialization **`fb091987e4daa0e7f69c7e95738b64d3ff98640961c3c30af3eeb06a21cdb8ad`**. This run only reads a pinned source bundle: **zero semantic-audit rows, zero Rule Set versions, no frozen inventory or activation**. Its signed `NOT_EVALUATED` HMAC fixture is not a semantic acceptance receipt.

Fresh real-model evaluation run ID: **none**; new paid model calls/input/output tokens: **0/0/0**. Historical aborted-run usage remains unavailable. Full release-image matrix, staging, browser acceptance, merge and deployment were **NOT_RUN**. Quota is a point-in-time availability check, not a model-liveness or budget guarantee. No broad local suite or manual CI rerun was launched; normal push-triggered checks verify each published head. Disk was checked before builds and remains 97% full with approximately 16 GB free.

Evidence: [`pypdf-security-20261022/preflight-summary.json`](pypdf-security-20261022/preflight-summary.json), lock-change receipt, focused test log/JUnit, clean-context source hashes, both build logs and installed-runtime/dependency receipts, complete `ci-candidate.json`, fixed-alert receipt, source/HMAC/database and provider-readiness snapshots, replayable provider-free probes and `preservation.json`. Raw worker-build and PDF-test logs are published as `.log.gz`, with byte-exact round-trip/hash receipts in `raw-log-archives.json`; original local logs remain unchanged. Evidence publication leaves runtime inputs unchanged; PR #427 records the exact publication head and its CI results separately. PR remains Draft. Next release gate requires a **separate authorization** for one bounded real-model evaluation; this task stops here.

## 15. Acceptance continuation — stopped at document provenance gate

Inspected/frozen candidate: **`6f37b38c2b38a93d92cc905d3dd432c3f2f9c40a`**, local ref `refs/lcsp360/acceptance-envelope-20261022-6f37b38c2`. Local and Draft PR heads matched; all three protected WIP hashes matched. No concurrent source edits or active live-evaluation processes were found. This pass contains evidence only; no runtime/dependency change or test-matrix rerun.

**Root cause:** `fixture_chunks.py` returns the true `sourceSha256`, but the live harness drops it when calling `seedLegalSource`. The shared helper writes `contentHash(name)` into the document's `sourceSha256`. Correct chunk/support hashes and authentic HMAC receipts can coexist with this incorrect document digest; the earlier provenance readiness statement was incomplete.

**Required fix, not applied under the stop-on-blocker instruction:** Carry the independently verified source-byte digest into the shared seeder, persist it as the document hash and add a focused provider-free regression. Recheck affected provenance gates on a newly frozen candidate. Do not repair retained databases or receipts in place.

Read-only persisted evidence from the owned preflight database `lcsp360_pypdf_preflight_7a3088043efe`, source version `6887d934-139f-4e16-8a05-c5f897a57661`:

- Actual pinned source digest: **`b69a711386e79d62e287eac4f8c447932c9a5b999e5618e623745b5c9f280cc1`** (1,185 source bytes; all 15 chunk hashes independently pass).
- Stored document digest: **`9f4ee581919363af294eb32196175da57961c290b68f0213581bf61e1fd846a9`**, exactly SHA-256 of fixture name `pypdf-preflight-1792643354451`, unequal to the source-byte digest.
- One SELECT with `default_transaction_read_only=on`; no new Preparation, evaluation or domain mutation. Owned container 55502 stopped afterward, volume retained. Historical 55441 was not started or queried. No resource was deleted.

Resource inspection: approximately **15.25 GiB free disk** and **4.98 GiB available RAM** at capture. Btrfs inode counters are dynamic, not exhausted. Docker has 285 images, 131 containers, 246 volumes and 1,020 cache records; reported shared/reclaimable sizes are not ownership proof. No large disposable resource was conclusively established, so no cleanup occurred. Small-run disk allocation (4 GiB working allowance plus 4 GiB reserve) fits. Memory changed during inspection; an initial larger proposal failed admission. A 3 GiB process-tree / 256 MiB PostgreSQL proposal still needs enforced limits and a fresh headroom check. No exact future peak is claimed.

Phase D resource gate is deferred and currently **BLOCKED**: historical four-image payload totals 8.63 GiB, with a largest sequential rootfs export of 2.44 GiB. Builds retain images and intermediates, and exports use RAM-backed `/tmp`. The envelope records a conservative 24 GiB free-disk planning floor, not a measured future peak. Do not build before semantic acceptance and fresh resource admission.

A **non-executable execution-envelope proposal** is published: one complete existing 15-chunk/12-unit synthetic source case, immutable source/config hashes, independent Producer/Auditor and unchanged fallback policy, **256 provider dispatches**, **4,000,000 input/cache tokens**, **256,000 output/reasoning tokens**, **USD 25 aggregate spending**, existing **3,600-second worker / 600-second request** timeouts and proposed **4,200-second total / per-stage limits**. These limits are unapproved and not workload/cost estimates. The controlled synthetic case cannot establish official-law corpus authority.

Paid authorization remains **0 calls / 0 tokens / USD 0**. The harness lacks shared pre-dispatch attempt/token/cost admission; completion metering and generic per-agent finalization are insufficient. Approved limits, verified tariffs/settlement and provider-free proof of enforcement are prerequisites after the document gate is fixed. No launch command is supplied and no approval is inferred from quota. Fresh read-only provider readiness passed; quota remains 4,692,038 units, with configured model advertised and key unexpired at capture. Live fallback balances/behavior are unverified.

| Gate | Status | Evidence |
|---|---|---|
| Identity, source immutability, protected WIP | PASS | Exact checkpoint/ref and recorded hashes |
| CI/security | PASS | Retained **39** successes on `6f37b38c2`; no rerun or reopened security finding |
| Source-file/chunk hashes | PASS | Independent full-source and 15-chunk recomputation |
| Persisted document-byte digest | **FAIL** | Stored hash equals name hash, not source bytes |
| Effects, graph support, HMAC/auth, accounting recovery | PASS | Retained provider-free receipts; no real-model acceptance claim |
| Provider metadata availability | PASS | Fresh read-only check; zero inference calls |
| Paid authorization / aggregate enforcement | BLOCKED | No approved spending or shared admission guard |
| Small-run resource headroom | PASS | Point-in-time proposed allocation only; enforcement not applied |
| Fresh real-model semantics, freeze, Requirements/Rules, Validator, persistence, activation | NOT_RUN | No new evaluation run or Rule Set version |
| Release-image capacity | BLOCKED | Deferred Phase D resource gate |
| Staging/browser, merge, production | NOT_RUN | C has not passed; no production authorization |

New real-model run ID / activated Rule Set version: **none / none**. New paid model calls/input/output/cost: **0 / 0 / 0 / USD 0**. Historical aborted-run usage and cost remain **UNAVAILABLE**. Stopped at the first verified integrity failure, as instructed; no paid retry, source patch or acceptance bypass followed.

Evidence and exact commands/results: [`acceptance-envelope-20261022/execution-envelope.md`](acceptance-envelope-20261022/execution-envelope.md), machine-readable `execution-envelope.json`, `document-digest-blocker.json` (full SQL and values), `source-snapshot.json`, resource/preservation/provider receipts, retained exact-head CI identities and checkpoint hashes. Raw host-wide inventories remain local with hashes in the resource receipt. **Next action: fix document source-byte digest propagation and add its focused regression before another provenance preflight.** PR remains Draft; status **BLOCKED**.

## 16. Document source-byte contract repair and corrected non-paid provenance checkpoint

Takeover/evidence HEAD: `604c4285c07229713e214d8bd37f62080975a91a`. Frozen code candidate: **`bf3bc2a409944746dc0185b6afa6693b75565089`**, local ref `refs/lcsp360/document-provenance-20261022`. **DOCUMENT_SOURCE_BYTE_DIGEST_BINDING: PASS. Release status: BLOCKED at shared paid-inference admission.** No paid authorization, model invocation, staging, deployment, merge or Draft removal occurred. Evidence publication adds receipts/documentation only; exact publication-head CI results are recorded in the PR checkpoint comment.

**Root cause:** `seedLegalSource` in `tests/support/compliance-rule-set-stack.mjs` wrote `contentHash(name)` as the document digest. Live callers dropped the fixture generator's source digest. Valid chunk hashes could not bind the document to the original source bytes. Section 15 and its failed database/receipt remain unchanged.

**Fix:** The shared helper requires original `Buffer` bytes plus an explicit raw or single-prefixed lowercase SHA-256. It validates presence, syntax and independently hashed byte equality before the first database write, then stores the canonical single `sha256:` prefix. No fixture-name/ID/chunk/metadata fallback exists. Missing bytes, missing/malformed digests and a well-formed digest for different bytes reject without changing any source/document/chunk/index row counts. The pinned generator reads raw bytes, checks the frozen pin before parsing and transports those same bytes with their digest. The unfamiliar control transports the actual ingestion bytes. In-memory fixture documents define reproducible UTF-8 bytes before deriving their existing chunks.

Changed contract/fixture/test/config files: `tests/support/compliance-rule-set-stack.mjs`; `deepagents/tests/vertical/{fixture_chunks,control_chunks,root_semantic_fixture}.py`; `tests/source-document-provenance.integration.mjs`; `deepagents/tests/test_fixture_source_bytes.py`; `.github/workflows/test.yml` (adds the PostgreSQL regression to the existing required Assessment Root job). Six active caller updates:

| Caller | Correct source representation / compatibility |
|---|---|
| `tests/compliance-rule-set-live-eval.mjs` | Verified pinned bytes/digest or actual unfamiliar-control ingestion bytes/digest |
| `tests/assessment-root-live-eval.mjs` | Exact original Root in-memory text bytes/digest; saved-run resume does not reseed |
| `tests/compliance-rule-set-vertical.mjs` | Deterministic UTF-8 source lines; existing locator content/chunk hashes retained |
| `tests/assessment-domain-vertical.mjs` | Variant-specific deterministic source lines; assessment/pinning semantics retained |
| `tests/assessment-hitl-vertical.mjs` | Deterministic source lines; existing Human Resolution/negative controls retained |
| `tests/assessment-browser-stack.mjs` | Deterministic source lines; scripted preparation starts and document digest matches |

All active direct/indirect seed callers were inspected. Four archived historical report probes retain their original source as evidence; they are superseded by the new `document-provenance-20261022/nonpaid_preflight.mjs` and fail closed if used without the new contract. They must not be used to mutate historical databases. No production legal interpretation, effects, Rule generation, HITL behavior, tenant boundary, audit code, metering/recovery code, model routes or security policy changed.

Focused provider-free commands/results (all actual process exits as stated):

| Command / gate | Result |
|---|---|
| `LCSP_TEST_PG_PORT=55503 LCSP_SOURCE_PROVENANCE_DATABASE=lcsp_source_digest_red ... node --test tests/source-document-provenance.integration.mjs`, before helper repair | **Expected FAIL**, exit 1: all 11 initial document-contract cases reproduce old name-hash/missing-validation defects against real PostgreSQL. Original rows/log retained in `red/` and `red.log` |
| Same test after repair, fresh `lcsp_source_digest_green`, separate `green/` output | **19/19 PASS**, exit 0: pinned/control, prefix, invalid/missing/mismatched digest, absent bytes and all eight Root fixture modes |
| `node tests/compliance-rule-set-vertical.mjs` with owned PG port 55503 | **77 checks PASS**, exit 0 |
| `node tests/assessment-domain-vertical.mjs` with owned PG port 55503 | **145 checks PASS**, exit 0 |
| `node tests/assessment-hitl-vertical.mjs` and `node tests/assessment-hitl-vertical.mjs --unresolvable-only`, sequential on 55503 | **79 and 72 checks PASS**, exits 0; audited freeze/typed authoring and negative controls retained |
| `PYTHON_DOTENV_DISABLED=1 PYTHONPATH=deepagents:deepagents/tests deepagents/.venv/bin/python -m pytest deepagents/tests/test_fixture_source_bytes.py deepagents/tests/test_legal_source_files_provenance.py deepagents/tests/test_legal_source_graph.py deepagents/tests/test_semantic_auditor.py deepagents/tests/test_single_pass_review.py -q --tb=short --junitxml=.../python-guards.xml` | **102 passed**, exit 0; pin-tampering rejection, provenance/graph, independent semantic-audit/HMAC guards |
| `node tests/assessment-browser-stack.mjs` controlled startup on 55503 | PASS: fixture creation, scripted preparation and direct persisted-digest assertion. Owned process stopped; previous browser fixture file restored. Actual browser journey **NOT_RUN** |
| `node .../document-provenance-20261022/nonpaid_preflight.mjs`, ephemeral random HMAC environment, frozen code candidate | **PASS**, exit 0; new database only, no model loader/inference |
| `python .../document-provenance-20261022/verify_postgres.py` | **PASS**, exit 0; independent Python SHA-256 and read-only `psql` query of document/chunks/materialization/nodes/mappings |
| JS syntax checks (8 changed scripts), workflow YAML parse, `node scripts/check-import-policy.mjs`, `git diff --check` | PASS |
| `graphify update .` | PASS AST update, exit 0. Optional SQL extraction dependency and oversized HTML warnings retained; no semantic/paid graph labeling requested |

Independent source-byte results:

| Value | Pinned source | Unfamiliar P10 source |
|---|---|---|
| Actual source SHA-256 | `b69a711386e79d62e287eac4f8c447932c9a5b999e5618e623745b5c9f280cc1` | `a7a4331fc5ce4d46362a7f58ba9e7cc63d15898ea0813c19cf5894bcd63e0ff9` |
| Persisted `sourceSha256` | `sha256:b69a711386e79d62e287eac4f8c447932c9a5b999e5618e623745b5c9f280cc1` | `sha256:a7a4331fc5ce4d46362a7f58ba9e7cc63d15898ea0813c19cf5894bcd63e0ff9` |
| Green-regression source version | `29e87344-ecc1-4cb3-8082-5eefe03f6bb5` | `25861510-5927-4695-ac47-f9c5bec67607` |
| Verified original chunks | 15 | 1 |

Frozen-candidate corrected preflight database **`lcsp360_document_preflight_7a02137e7775`**, owned loopback **55503**, diagnostic API **3461**:

- Source version **`04c26c33-a408-45a4-aa09-0ce1728ca98c`**, document `SYNTHETIC-NOTICE-INSTRUMENT`, document row `9c2b5412-2e17-4864-979c-df68cc16677f`.
- 1,185 source bytes independently hash to `b69a7113…0cc1`; PostgreSQL stores the exact prefixed digest above. Name `document-preflight-1792659826070` hashes to **`76623909f6f4f6a1ad6f58026766f1331d6a3cc556e7fd70cc9975a60f596fc6`**, which differs from the stored digest.
- Diagnostic preparation ID **`2e07850a-4f00-416b-8bc0-dc225b634230`**, graph materialization **`2924ffb8a2bb46adc64f5765b1a5f8d3d6d56be73445e988f11705c2e1656e79`**. This is a source-claim diagnostic, **not a real-model evaluation**.
- All **15** persisted chunk hashes/content/document references, **20 EFFECTIVE graph nodes**, **15 chunk-to-node mappings**, source version/materialization/document identities and **18 independently recomputed source-support hashes** pass. Read-only SQL and full comparisons are in `independent-postgres-verification.json`.
- Python signing plus independent Node HMAC verification pass with an ephemeral random shared key; tamper and wrong-run checks reject; missing worker authentication returns 401. Only key fingerprint/signature retained. Signed receipt verdict is **NOT_EVALUATED**, purpose `HMAC_PREFLIGHT_ONLY`; it proves integrity only. **Zero persisted semantic audits, zero Rule Set versions**, no inventory freeze or activation in this diagnostic.

**Remaining root cause — shared admission:** `UsageMeteringMiddleware._prepare` checks cancellation, identity and context; downstream handler dispatch precedes `_record`. The existing durable `LiveUsage` persists completed reported usage correctly, but does not admit/reserve future attempts, tokens or money. `AgentRunBudgetMiddleware` is an individual graph/context finalizer. The provider-free boundary probe exercises real shared metering plus durable record/recovery with an offline handler: **3 synthetic attempts** across Producer/Auditor, only **2 committed responses**, with the third unanswered failure. Its fixture totals (20 input / 6 output) are explicitly synthetic, not paid usage. Diagnostic PASS does **not** establish a financial admission gate.

**Smallest justified next fix identified:** Extend the existing shared innermost metering boundary with atomic run-scoped pre-dispatch reservations, shared through `AgentRunState` and existing durable recovery. It already sits inside application retries, credential rotation and provider fallback. Prove sync/async and internal reader/summarization coverage; separately intercept SDK-internal retries or reserve verified worst-case bounds for all attempts (Google currently allows an SDK retry). Freeze authoritative provider tariff/charge upper bounds and conservative token/cache/reasoning reservations. Unknown/unbounded charges must fail closed; unresolved reservations survive crash; budget denial terminates without generic forced-finalization or fabricated acceptance. No provider tariffs were invented and no new accounting/agent architecture was added. This mechanism remains **NOT_IMPLEMENTED / NOT_PROVEN**, so overall status is **BLOCKED**, not PREFLIGHT_READY or AWAITING_PAID_AUTHORIZATION yet.

The execution envelope remains non-executable, with no launch command. Proposed **256 dispatches / 4,000,000 input-cache tokens / 256,000 output-reasoning tokens / USD 25**, existing **3,600-second worker / 600-second provider** and proposed **4,200-second overall** limits remain **unapproved**. Authorized/actual paid calls, input/output tokens and spending this task: **0 / 0 / 0 / USD 0**. Historical aborted usage/cost remain **UNAVAILABLE**. Model routes/provider credentials were not changed; earlier read-only quota/catalog evidence is point-in-time only, not fresh liveness or spending authority.

| Acceptance gate | Current result |
|---|---|
| Document/source-byte digest binding | **PASS** on new frozen candidate, independently read-only verified |
| Chunk provenance/effects, graph/source/support identities | **PASS** provider-free |
| Signed receipt integrity / authentication rejection | **PASS** provider-free; semantic verdict NOT_EVALUATED |
| Shared seeder callers, claim-first Root/HITL/Validator fixture journey | **PASS** provider-free, including negative controls |
| Durable accounting/recovery and semantic runtime preservation | PASS source-hash preservation; prior accounting regressions retained; current Python CI required |
| Exact-code-candidate CI/security | **PASS: all 36 checks** on `bf3bc2a409944746dc0185b6afa6693b75565089`, including V2 required gate, Assessment Root, Docker E2E, Python/API/web/Playwright, Trivy, Trustabl and CodeQL; `ci-code-candidate.json` |
| Paid admission / budget authorization | **BLOCKED**: shared enforceable reservation absent; no paid approval |
| Fresh real-model semantic inventory, Requirements/Rules, persistence/activation, API/tenant assessment acceptance | **NOT_RUN** |
| Release-image / staging / browser acceptance | **NOT_RUN**; semantic gate first, later build headroom still below prior planning floor |
| Merge / production | **NOT_RUN**, unauthorized |

Resource/preservation receipt: `preservation-resources.json`. Remaining free disk approximately **15.12 GiB** (97% used); no large build or cleanup. Only the new task-owned PostgreSQL container/volume was created with **256 MiB** memory cap. Red/green/corrected-preflight databases and volume are retained; diagnostic API and owned container are stopped. Historical 55441 was never started/queried; retained failed 55502 was never started/modified. All three protected WIP hashes match, and no protected file is staged. Production, semantic-audit, durable accounting/recovery and provider-route source hashes remain unchanged. Section 15 and the original digest-blocker JSON remain historical evidence.

Evidence: [`document-provenance-20261022/independent-postgres-verification.json`](document-provenance-20261022/independent-postgres-verification.json), `database-source-hmac-preflight.json`, red/green receipts and logs, focused JUnit/log, affected-journey logs, browser-startup receipt, complete exact-code-candidate CI receipt, provider-free budget-boundary probe/receipt, preservation/resources receipt and replayable non-paid probes. The original red/green/Python logs are archived byte-for-byte as `.log.gz`; `raw-log-archives.json` verifies their hashes and decompression round trips. All acceptance claims are scoped above; fixture success does not prove real-model semantics. **Single next action: implement and provider-free verify the identified shared pre-dispatch admission mechanism with verified provider charge bounds before seeking paid approval.** PR remains Draft.

## 17. Atomic shared paid-inference admission — offline pass, real charging contracts blocked

Takeover HEAD: **`14d70f2f6f3f08bc2bf8a81d27443440be7528ec`**. Implementation commit: `f9f189040d456afdb621f0269b483a700262b3c8`. Credential/SDK verification repair: `af28dff97a8952572c87215d607dfac57cdc1570`. Visible overage retention: `15402a8cdd6ffeb66775a964b710f498664a791f`. Final frozen source/cache-reconciliation candidate: **`1ed318e4257d93b7ea89973832afedad766a036a`**, ref `refs/lcsp360/paid-admission-reconciled-20261022`. The last source commit is published together with the evidence commit; exact final publication HEAD and its fresh CI/security results are recorded in the PR checkpoint comment. **Status: BLOCKED at VERIFIED_ACCOUNT_CHARGE_AND_TOKEN_BOUND_CONTRACTS.** Offline admission success does not establish real-world provider billing or semantic acceptance.

**Root cause:** `UsageMeteringMiddleware` dispatched before completed-response accounting, so an unanswered charged request had no reservation. Producer/Auditor and framework model operations had no shared atomic pre-dispatch exposure check. Completion-only accounting and per-agent graph finalization could not enforce an aggregate financial ceiling.

**Fix:** Extend the existing `AgentRunState`/innermost metering boundary with a digest-pinned immutable `RunBudget` and `RunAdmission`, backed by two tables in the **same usage SQLite file**. No agent pipeline, customer-credit reservation, dependency or legal-semantic rule was added. `BEGIN IMMEDIATE` serializes admission across threads/processes; `synchronous=FULL` commits before the downstream handler. Composite run/attempt uniqueness prevents duplicate admission. Original reservation amounts, state history, actual usage, known charge and unresolved exposure are retained. Call reservations are never refunded. Complete authoritative usage can release only established unused input/output/charge capacity; missing buckets remain unknown, including unreported cache/reasoning zeros.

The lifecycle is PENDING inside the atomic check, then durable **ADMITTED → IN_FLIGHT → SETTLED / OUTCOME_UNKNOWN**, or durable **DENIED**. Timeout, cancellation, transport failure and crashed ADMITTED/IN_FLIGHT attempts retain full exposure. Late responses settle once. A crash between the existing usage-evidence commit and settlement is recovered idempotently without provider replay. Denial latches the run and raises `PaidAdmissionError`, terminal for application retry, credential rotation, provider fallback and task delivery. A provider-reported bound breach stops dispatch and retains the larger reported exposure; a provider that contradicts its charge contract cannot be retrospectively kept inside a promised cap. Such a breach remains failure, never a passing invariant or silently zeroed charge.

| Modified file | Responsibility |
|---|---|
| `deepagents/middleware/paid_admission.py` | Strict immutable budget/policy schemas; atomic reservation/settlement/recovery; native account/endpoint/model/route/SDK binding and cap verification |
| `deepagents/middleware/usage_metering.py` | Shared bounded scope on AgentRunState, sync/async pre-dispatch admission, late settlement and unknown-outcome handling |
| `deepagents/middleware/usage_recovery.py` | Documents evaluation tables in the same existing durable usage store; callback drain remains usage-only |
| `deepagents/middleware/failure_policy.py` | Typed terminal admission error and explicit no-retry classification |
| `deepagents/middleware/provider_fallback.py` | Admission denial takes precedence over nested provider/auth errors; no fallback/circuit poisoning |
| `deepagents/middleware/token_fallback.py` | Admission errors cannot rotate credentials |
| `deepagents/tests/vertical/live_preparation.py` | Requires a frozen budget/file fingerprint before model construction; terminal usage report includes reservation recovery; historical journals stay distinguishable |
| `deepagents/tests/test_paid_admission.py` | Final **65** offline admission/concurrency/recovery/SDK/semantic-isolation cases |
| `deepagents/tests/vertical/bounded_admission_rehearsal.py` | Replayable configured-stack offline rehearsal; synthetic policy only, no provider networking |

**Dispatch coverage:** existing `MODEL_GOVERNANCE_MIDDLEWARE` already places metering inside model retry, provider fallback, credential rotation and schema handling. Producer, independently constructed SemanticAuditor, source reader and governed internal summarization use this stack and inherit the same run-scoped context. Attempts get the same UUID for admission, telemetry, durable usage and settlement. Sync and async paths use the same SQLite transactions; blocking admission/reconciliation runs off the async loop. Switching/removing the bounded scope rejects. Separate processes reopening the same envelope cannot race past limits. General unbounded dispatch, fallback and legal behavior remain unchanged; normalized gateway cache accounting is corrected below; the standalone live evaluation CLI now always requires bounded configuration.

**SDK retry correction:** the previous review called Google's `max_retries=1` an internal retry. Installed source and native mock-HTTP tests show it is **one total attempt**, mapped to `HttpRetryOptions(attempts=1)`. The bounded path explicitly pins one attempt, disables Google SDK automatic function calling and forces one candidate; OpenAI-compatible requests force `n=1`. Anthropic/OpenAI SDK retry counts must be zero in both native clients; unsupported/overridden options fail closed. Native output caps are inspected in real SDK payload construction. SDK versions (including the actual HTTP transport family), actual credential identities and endpoint fingerprints bind each policy. No production route order or retry settings were casually changed.

**Security/CI findings corrected, without exclusions:** initial CodeQL check [119776260522](https://github.com/khov4nfs/LCSP/runs/119776260522) flagged fast SHA-256 hashing of the SDK API credential. It now uses **PBKDF2-HMAC-SHA256, 600,000 iterations**, with a per-run envelope-pinned salt; real envelopes require a fresh random 32-byte salt. Public `c*64` values are explicitly offline fixture salts. Policy schema 2 binds the salt. Older policy-format reservations remain readable, conservatively retained and never repriced under schema 2. No advisory/policy dismissal was used.

The first full Python CI run on `f9f189040` had **1943 passed, 63 skipped, 2 failed**. Both failures were new Anthropic transport tests with zero observed requests. Reproducing CI's Anthropic 1.17.0 / langchain-anthropic 1.7.6 in a task-owned isolated overlay exposed `httpx2.URL` being passed into the test's injected `httpx.Client`. The test now uses the actual SDK transport family; it preserves the one-request assertion. **6/6** native transport cases pass with the newer overlay. The overlay retained older local langchain-core and emitted two version-profile warnings, so it is a focused compatibility diagnostic, not a full CI-environment claim. Runtime dependencies/uv.lock were not modified. Exact-new-publication-head CI must still pass and is recorded separately below/in the PR checkpoint.

| Command / attempted gate | Actual result |
|---|---|
| `.venv/bin/python -m pytest` over the 13 focused admission/metering/telemetry/live-usage/fallback/runtime-control/auth/model-unavailable/output-cap/preparation-governance/semantic-auditor/stream-usage files, provider dotenv disabled | **441 passed**, 0 failures, on the initial implementation source; `frozen-focused-tests.xml` and command receipt retain scope |
| Final focused suite including admission/cache reconciliation and the existing related guards | **445 passed**, including **65 admission cases**; `reconciled-focused-tests.xml`. Covers salted identities, old-policy preservation, visible overcharge and exact cache/charge arithmetic |
| Newer SDK overlay, same test file, `-k native_sdk` | **6 passed**, 57 deselected at that capture; two profile-version warnings retained |
| `PYTHON_DOTENV_DISABLED=1 PYTHONPATH=deepagents:deepagents/tests deepagents/.venv/bin/python deepagents/tests/vertical/bounded_admission_rehearsal.py .../reconciled-rehearsal` | **OFFLINE_ADMISSION_PASS** on frozen `1ed318e42`; no paid endpoint |
| Import policy, changed-Python AST parse, diff whitespace | PASS |
| `graphify update .` | AST-only update PASS; optional SQL extractor/large-HTML warnings retained, no paid labeling |
| Fresh CI/security | **All 36 predecessor checks PASS** on `af28dff97`, including Python workers, CodeQL, Trivy, Trustabl, Docker E2E and V2 gate (`ci-corrected-predecessor.json`). Final publication HEAD adds tested overage retention/evidence and requires its own fresh checks, recorded in the PR checkpoint. Prior 38 checks on `14d70f2f6` are historical |

The final configured-stack rehearsal uses **synthetic, explicitly non-authoritative** policies: **7 offline handler dispatches**, **4 completed responses**, **3 unresolved attempts**, a terminal `CALL_LIMIT`, and **no eighth dispatch**. It includes application retry, credential rotation, provider fallback, separately constructed Producer/Auditor agents, concurrent internal summarization, durable usage recovery and SQLite integrity verification. Journal exposure remains within this synthetic envelope; unresolved reservations remain included and aggregate actual charge is null. The deliberately generous offline fixture limits differ from the proposed paid envelope and do not amend or approve it. Offline run ID: **`offline-admission-rehearsal`**. This is not a real-model Preparation run and creates no API/Rule Set artifacts.

**Cache reconciliation correction:** the new rehearsal exposed that normalized OpenAI-compatible gateway usage retained cache slices in `inputTokens`, unlike native OPENAI and normalized Anthropic. `extract_provider_usage` now subtracts cache slices once for normalized OpenAI protocol responses too, including Inception. Raw Anthropic behavior is unchanged. A new regression and all six route assertions independently establish 10 uncached + 2 read + 1 write + 3 output = 16 reported total tokens. Read-only SQLite/arithmetic verification finds four synthetic charges of 230 nano-USD (920 known total), three full unresolved reservations and no hidden overage. Earlier pre-correction rehearsal files remain preserved; no real financial charge or historical usage row was rewritten.

**First remaining external blocker:** no complete account-specific `ChargePolicy` has been verified for any of the six configured route IDs. Policies require strict provider-guaranteed charged-input/cache/system/tool/overhead bounds, an output/reasoning bound enforced by native parameters, exact USD bucket rates after multipliers/FX, fixed/minimum/rounding charges, credential/account and endpoint identity, validity dates, reviewer and evidence fingerprint. The local request estimator is never used as this bound. Complex/incomplete tariff contracts are unsupported rather than approximated as an actual charge. All configured unknown-policy cases reject before their offline handlers.

| Current route/model | Authoritative public evidence inspected | Unresolved contract / admission |
|---|---|---|
| Mirai `primary` / `semantic-primary`, Claude Sonnet 5, Anthropic | [Mirai usage/pricing UI](https://miraiapi.com/usage/) describes quota weighted from input/output and a model ratio | Account USD conversion, cache/reasoning/fees and strict charged-token guarantee absent; **DENIED_UNKNOWN_TARIFF** |
| Inception `fallback`, Mercury 2.5, OpenAI | [Official model announcement](https://www.inceptionlabs.ai/blog/introducing-mercury-2-5) lists standard prices and a launch promotion | Exact account/effective promotion, complete fee/cache rules and charged-token guarantee unverified; **DENIED_UNKNOWN_TARIFF** |
| Google `fallback-01`, Gemini 3.5 Flash Lite | [Official Gemini pricing](https://ai.google.dev/gemini-api/docs/pricing) lists differing tier/token/cache-storage charges | Configured accounts/tier and complete strict token/charge contract unverified; **DENIED_UNKNOWN_TARIFF** |
| APX `fallback-02` / `semantic-final`, Claude Sonnet 4.6 Free, Anthropic | [Official APMIX pricing](https://apmix.ai/pricing) describes weighted allowances, taxes/top-ups and one-time free allowance | Exact account terms and comprehensive zero-dollar/charging bounds unverified; the model name is insufficient; **DENIED_UNKNOWN_TARIFF** |

No upstream Anthropic tariff was substituted for a gateway contract. No real policy fingerprint or effective account date was invented; both remain null/unestablished in `tariff-review.json`. This is the first unresolved gate, so status is **BLOCKED**, not ADMISSION_PASS or AWAITING_PAID_AUTHORIZATION. All proposed **256 dispatches / 4,000,000 input-cache tokens / 256,000 output-reasoning tokens / USD 25 / 3,600-second worker / 600-second provider / 4,200-second total** ceilings remain unapproved. The execution envelope is non-executable, launch command null, paid authorization zero. Deadline/resource execution admission remains a subsequent prerequisite.

| Release gate | Status |
|---|---|
| Shared durable atomic admission and terminal error propagation | PASS in provider-free tests and configured-stack rehearsal |
| Concurrency, crash/unknown retention, late settlement and old-journal preservation | PASS provider-free |
| Native single-attempt dispatch and output-cap propagation | PASS mock-HTTP sync/async; actual billing NOT_VERIFIED |
| Source-byte provenance, semantic/HMAC logic, route order, dependencies | Preserved unchanged Git objects; earlier fixtures remain evidence, no unnecessary PostgreSQL/matrix rerun |
| Current publication-head CI/security | Fresh required results in exact-head PR checkpoint; no historical-head substitution |
| Complete verified real charging/token-bound policy | **BLOCKED**, no approved production policies |
| Paid approval | **ABSENT**; proposal only |
| Real-model semantic acceptance / Rule Set activation | **NOT_RUN** |
| Release-image / staging / browser / merge / deployment | **NOT_RUN**, unauthorized for this task |

Protected WIP SHA-256 values remain identical. Historical 55441 was not started/queried; 55502 and 55503 were not started/modified and retain their stopped containers/volumes. No Docker resource or database was created or removed. Only task-owned offline SQLite/tmp test resources and a small SDK overlay were used. Disk remains approximately **15.12 GiB free**, 97% used; no large build/prune. Source-byte, source graph, semantic auditor, HMAC, model routes and dependency Git objects match takeover HEAD. Final preservation and file-hash receipts accompany this section.

Paid calls / paid input-output tokens / paid spending this task: **0 / 0 / USD 0**. Historical real-run usage/cost remain **UNAVAILABLE**. New real-model run ID / activated Rule Set version: **none / none**. Evidence: [`paid-admission-20261022/`](paid-admission-20261022/), including frozen and v2 test JUnit/log archives, native-SDK diagnostic, original CodeQL/Python CI failures, final rehearsal/budget/usage/SQLite journal, tariff review, preservation and exact commands/source hashes. Initial failed and passing checkpoints are retained. PR #427 stays Draft.

**Single next action: obtain and independently verify the complete account charging and strict token-bound contracts for all configured routes, starting with Mirai, then pin reviewed policies before seeking paid authorization.**

## 18. Real-provider contract verification — external account evidence unavailable

Reviewed publication HEAD: **`090775bb763b8bbcf43d524050b03de4424755fe`**. Frozen admission source: **`1ed318e4257d93b7ea89973832afedad766a036a`**. Environment: existing local checkout/.venv, original configured provider pools, no production or account portal access. This publication changes evidence and provider-free diagnostic tests only; admission, routes, dependencies, legal semantics, source/HMAC logic and historical receipts are unchanged. The new publication SHA and its own push-triggered checks are recorded in the PR checkpoint, without treating the prior 38 checks as new-head proof.

**Status: BLOCKED_EXTERNAL_CONTRACT_EVIDENCE.** The user explicitly confirmed no authorized billing records, read-only account sessions or verified account-owner contacts were provided. No account/Cloud Billing CLI or authenticated provider billing endpoint was accessed, no key was submitted to a website, and no credentials were requested. Five scoped connected Drive searches (Mirai, Inception, APMIX, LCSP billing, Gemini billing) returned no results. Repository evidence contains earlier public tariff findings, not accepted account contracts; absence in these searches is not a claim about every possible storage location.

**Root cause:** local API credentials and public prices identify neither the accepted account tariff nor a complete guaranteed maximum charge per request. Provider-specific quota/entitlement, cache/reasoning, fees, failed-request and validity evidence is missing. **Fix/boundary:** preserve the existing fail-closed admission implementation, publish sanitized slot-level findings and prepare exact owner evidence requests. No guessed price, artificial token bound, synthetic production policy, reduced fallback topology or validation exception was introduced.

### Actual topology and identity verification

The actual local native SDK clients produced **40 route/credential bindings across 30 distinct provider credentials**: Mirai 1, Inception 14, Google 6, APX 9. Mirai and APX credentials appear under separate Producer/Auditor route IDs. Distinct credentials do not prove distinct billing accounts. The matrix records every slot's provider/model/protocol/route, salted PBKDF2 credential fingerprint, endpoint and SDK fingerprints, local SDK versions, evidence URL/capture time/body digest, unavailable account/plan/validity fields, review status and exact unresolved requirements.

The inspection uses the real `request_identity`, `model_with_token`, `UsageMeteringMiddleware`, `AgentRunState`/`LiveUsage` and native model construction, with socket and native HTTP transports blocked. **40/40 unknown-contract bindings were denied before the handler; handler calls 0, network attempts 0.** Zero-ceiling, policy-free diagnostic budgets lived only in owned temporary SQLite files and were removed by `TemporaryDirectory`; these are not Preparation/evaluation runs. The unique snapshot salt is public metadata, not a paid envelope or credential. Account aliases are explicitly UNVERIFIED. SDK versions are local identities, not a claim about an unbuilt release image.

Producer: `primary → fallback → fallback-01 → fallback-02`. Independent Auditor: `semantic-primary → fallback → fallback-01 → semantic-final`. Internal source-reader/summarization model operations retain the existing governed route/run. Role mappings and route options are unchanged; no fallback was silently disabled. Local SDK identities: langchain-anthropic 1.7.2 / anthropic 0.125.0 / httpx 0.28.1; langchain-openai 1.6.0 / openai 3.3.1; langchain-google-genai 4.4.0 / google-genai 2.25.0.

### Public versus account versus hard-bound evidence

| Provider / routes | Independently established public facts | Account and complete hard-bound result |
|---|---|---|
| Mirai — `primary`, `semantic-primary` | Official usage page gives the quota formula; its unauthenticated catalog reports active `claude-sonnet-5` ratio **0.5**. Catalog effective/expiry dates are not established. The key-check UI states server-side key retention; no key was submitted. | **BLOCKED**: no accepted account ratio/plan, quota-to-USD or maximum incremental USD contract, cache/reasoning/failure/fee guarantees, or all-request charged-token bound. |
| Inception — `fallback` | Current official model table lists standard input/cache/output prices and a 65,536 output ceiling; the older announcement describes a launch promotion. API documentation describes a combined reasoning/completion cap. | **BLOCKED**: fourteen slots have no account/promotion mapping; complete charged-input/tool/overhead/cache-write/failure/fee and validity guarantees unavailable. A 260K context label is not a proved exact billable-input bound. |
| Google — `fallback-01` | Official model page lists 1,048,576 input / 65,536 output limits; token documentation addresses system/tools and pricing includes thinking, cache and separately charged features. Billing guidance explicitly allows delayed prepaid/project-cap overages and optional auto-reload. | **BLOCKED**: six slots lack key→project→billing-account/tier mappings and accepted terms/settings; full charged-unit/cache/storage/tool/failure coverage not established. No token-count endpoint called; balances/caps do not prove a USD 25 hard stop. |
| APX — `fallback-02`, `semantic-final` | Exact gateway model has public 1× weighted-token pricing and one-time 3M new-account allowance. Terms dated 2026-10-16 describe exhaustion rejection, automatic renewal and separately purchased top-ups; model page gives a 200K context label. | **BLOCKED**: nine slots lack accepted account/remaining entitlement and complete charge/token-bound contracts. Free/prepaid names do not prove zero incremental USD exposure; renewal/fees and all request units require evidence. |

**Zero verified account contracts; zero production ChargePolicies; zero eligible routes.** Public numeric rates are retained only as public evidence in `provider-contract-review.json`; they are not copied into policies. No upstream tariff replaced a gateway contract. No arbitrary quota conversion or amortized subscription rate was invented. A real prepaid/fixed-entitlement contract might be representable only after a verified all-charge/zero-incremental-charge guarantee, request-unit bounds and renewal/window scope are known; representability is currently undetermined. Independent account-contract review is PENDING, not fabricated from this agent's public review. The matrix has an immutable review fingerprint; production policy fingerprints remain null.

Official references and raw-body SHA-256 capture receipts are in `public-captures.json`. Fourteen distinct official sources were captured successfully (including Mirai catalog). Four initial Google body-download timeouts are retained; English-query captures succeeded. Full public bodies remain task-owned local temporary files; only sanitized summaries/digests are committed. No private account document exists in this evidence set. [Prepared owner request and secure submission procedure](charging-contracts-20261022/ACCOUNT_EVIDENCE_REQUEST.md) identifies each authoritative portal/owner role and exact required proof; it is unsent. No approved restricted document location or named account owner was invented.

### Provider-free verification and resource readiness

| Actual command / gate | Result / limit |
|---|---|
| `PYTHON_DOTENV_DISABLED=1 PYTHONPATH=deepagents:deepagents/tests deepagents/.venv/bin/python .../inspect_bindings.py .../credential-bindings.json` | PASS: **40 denials**, 30 distinct credentials, **0 handlers / 0 network attempts**; same production identity/admission boundary, no billing access |
| `.venv/bin/python -m pytest .../test_contract_policy_boundary.py -q --tb=short --junitxml=.../contract-policy-tests.xml` with provider dotenv disabled | **14 passed**: 12 required-field omissions, future-dated policy rejection before dispatch, independent worst-case/minimum/rounding arithmetic over **72 vectors** |
| Original 445 regressions / 65 admission cases and 6 newer-SDK diagnostics | Preserved unchanged-source receipts; **not rerun**. Existing mismatch/expiry/fallback/shared-role protections remain tied to identical code hashes. Fixture success is not real billing evidence. |
| Owned `systemd-run --user` rehearsal with MemoryMax=3 GiB, CPUQuota=200%, RuntimeMaxSec=1, KillMode=control-group | PASS: parent/child inherit limits; deadline terminates owned tree, **0 active owned processes remain**. Capability proof only, no live evaluation limits applied. |
| Existing `runPython` helper with a 250 ms offline sleeper | PASS: SIGKILL, **261 ms** observed; no stack/database/API started |
| Resource capture | **15.10 GiB disk / 6.61 GiB available RAM** at capture; proposed 4.25 GiB memory allocation and 8 GiB initial disk floor fit at that instant. Dynamic Btrfs inodes are not exhausted. Exact future peak remains unavailable; release-build proposed 24 GiB floor still fails. |
| Deadlines / write ceilings | Worker 3,600 s timer and live provider override 600 s exist. Checkout's provider default is currently 3,600 s; harness override is necessary. **Global 4,200 s, per-stage supervision and live disk/evidence/database ceilings are not wired/applied**. Process-tree limits are not yet attached to a real evaluation. |
| Historical admission-code CI/security | **38/38 PASS** on exact `090775bb...`, recaptured in `ci-admission-publication.json`. New evidence publication results belong to its own exact HEAD and PR checkpoint. No manual broad CI rerun. |

This task did not implement a parallel budget/deadline system. The fresh envelope records the external account blocker and subsequent deadline/resource prerequisites, keeps all proposed limits unapproved, sets `executable=false` and `launchCommand=null`, and permits zero paid calls/tokens/spending. No inference or token-counting request was used to discover billing. A technical policy would still require separate spending authorization and fresh immutable source/HMAC/isolation/resource admission.

### Preservation and release state

All original three protected WIP SHA-256 values are unchanged. Historical 55441 was not queried/started; stopped 55502 and 55503 containers and their volumes remain retained. Historical report sections 12–17, the provenance failure/passing receipts, usage journals and signed receipts remain unchanged. No Docker image/build/volume cleanup, retained database mutation, release-image execution or staging occurred. No app/runtime/dependency/route code changed.

Evidence directory: [`charging-contracts-20261022/`](charging-contracts-20261022/). Commands, source/evidence fingerprints, independent reconciliation and preservation receipts accompany this section. PR #427 remains Draft. Paid calls / tokens / cost: **0 / 0 / USD 0**. Historical real usage/cost: **UNAVAILABLE**. New real-model run ID / activated Rule Set version: **none / none**.

**Next action:** the LCSP Mirai credential owner supplies the dated account-to-slot charging and strict token-bound statement through an approved restricted evidence location, with a sanitized digest-linked extract for independent review; see the prepared request.
