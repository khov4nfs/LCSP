# LCSP-347 technical hardening handoff

This supplements, and does not replace, `rule-build-acceptance-handoff.md`. No paid model execution, legal approval, instruction approval, source migration, activation, merge or deployment was performed.

## Baseline and publication

- Repository: `khov4nfs/LCSP`, existing PR #456, `feat/LCSP-347-assessment-prompt-locales`, OPEN/Draft.
- Initial HEAD: `34e567eb54786591b7c64b751f2f608c5b705422`; base `develop`: `e3669b04e791e59f06cbe19f8f51f49705e05e96`. Initial worktree clean; remote HEAD matched. No intervening remote commits at initial fetch.
- Initial complete check list: 37 checks, 36 success and one failure, `trustabl` check `129140599374`. Tests workflow `42611361777` and Security and Quality workflow `42611361805` succeeded.
- Repair commit: `bb14ddea751fefede3914ae9aaa0392ff3bbd932`.
- Admission commit: `62820655b9a445ed62700d6e87f7878004499eab`.
- Final publication HEAD is the commit containing this handoff and the readiness/review regression changes; the exact SHA and new CI URLs are recorded in the final execution report. This pre-publication evidence does not claim a new GitHub check conclusion.

## Root cause and fix: Trustabl versus Code Scanning

GitHub's annotation identifies alert #139, LC-028, at `rule_set_preparation/tools.py:837`. The scanner's native finding is informational; its SARIF rule has default level `note` and `security-severity: 0.5`. GitHub reports one new low-severity security alert. The Actions integration uses `severity-threshold: none`, and native exit was zero; neither means the separate Code Scanning check accepted the alert.

Trustabl 0.1.16 was downloaded from its official release and checked against the release checksum. The same signed production rule digest `b55cbae4eb9f36ab3db73783061b9ad5d083e7b5ef80d0df9ef202432b874c7f` reproduced the original findings on both this PR and a detached, unchanged current `develop` worktree. All three scans (PR before, develop, PR after) have the same rule/file/tool finding multiset: 21 findings, 17 low and four informational, two production and 19 test-path findings. The original develop GitHub analysis used 0.1.15 and had 18 findings. Therefore this is not evidence that LC-028's underlying code was introduced by LCSP-347.

The exact 21 finding dispositions are in `technical-remediation-evidence.json`. No test fixture was rewritten to reduce findings. No scanner rule, severity threshold, suppression or security workflow was changed. No GitHub alert was dismissed by this Coding Agent.

`GET /repos/khov4nfs/LCSP/code-scanning/default-setup` returns HTTP 403 with the current credentials. The precise repository Code Scanning policy cannot be inspected through that endpoint. Available rulesets were read without alteration; they are not evidence that a low-security alert is accepted. The alert needs maintainer/security disposition unless the new check independently accepts it. Native scanner exit zero and SARIF generation are reproducible; **the external check remains separately governed**.

### LC-001

The existing GitHub alert #75 is already dismissed as a false positive, with a recorded explanation of the table-driven constructor. `build_claim_tools()` supplies each `StructuredTool.from_function()` an explicit description and schema. A regression now serializes actual tools through LangChain's model-facing converter and verifies names, descriptions, closed schemas and the authoring authority contract. No runtime semantics were changed to appease this heuristic.

### LC-028 and actual repair authority

**Root cause:** the legacy packet tool cleared cached validation after draft edits, but retained `context.removable`. An old failure, or a failure from an independently supplied packet, could authorize deletion of a same-labeled item in a changed draft. Removal trace recorded counts but not the exact requested/accepted/refused labels.

**Fix:** removal authority now records the exact failed draft snapshot. New validation attempts and additions clear it; external packet validation cannot grant draft-removal authority. Removal compares the current packet with the recorded snapshot and consumes the allowlist, requiring revalidation afterward. Terminal and inventory-owned mutation guards remain enforced. Audit trace contains requested labels, actual removals, refused/unknown labels and validation codes/references; source bodies and validation detail prose are excluded.

The model-facing parameter schema is unchanged. No arbitrary `claim` argument was added. The supported source-graph/frozen-inventory tool factory excludes this legacy tool, verified by regression; legacy callers still receive safe validated repair behavior. The residual scanner recommendation about an explicit `claim` parameter is not an approval decision or evidence of an unrestricted production tool.

## Root cause and fix: expiring paid admission

**Root cause:** `RunAdmission.admit()` evaluated authorization/policy time before waiting for the journal transaction lock. A contender could pass the time check, wait for another process, then reserve after expiry. Dispatch transition did not recheck expiry after an earlier reservation.

**Fix:** time checks occur inside the serialized reservation transaction and again before `ADMITTED -> IN_FLIGHT`. Expired dispatch is rejected durably without releasing reserved exposure or resetting the journal. An already-reserved concurrent attempt retains its allowance if another contender exhausts an aggregate limit; it must still have a valid time window. Late usage settlement remains possible and cannot be reverted to unknown.

Existing paid-admission tests cover monetary/input/aggregate-output ceilings, physical attempts including retries and uncertain outcomes, missing pricing, frozen route/credential/SDK identity, fallback denial, shared parent/child/summary budgets, cross-process journal serialization, recovery, idempotency and immutable-budget resume rejection. New regressions cover expiration during lock acquisition and between reservation/dispatch. Windows abrupt-process recovery uses the platform's actual termination primitive; Linux SIGKILL behavior is retained. No test is skipped and no per-call output ceiling is reduced.

These are mechanics with synthetic tariffs and blocked provider networking. They do not approve real Inception prices, prove actual provider cost or authorize spending. SQLite guarantees apply to processes sharing the same governed journal, not arbitrary replicas with independent files. A diagnostic launch must preserve the owned journal across restart/resume; it must not create a fresh store to reset authorization.

## Root cause and fix: readiness and reviewer materials

**Root cause:** the source diagnostic's top-level state considered schema gaps but did not explicitly summarize ambiguous source or integrity/retrieval evidence blockers. Its URL parser, like the legal exporter, could emit an invalid credential-bearing input outside sanitized error handling. The instruction exporter did not reject surplus/duplicate manifest rows; the legal exporter's overwrite guard did not protect every partially reviewed field.

**Fix:** extracted testable read-only collection reuses the existing availability loader, reports source/schema blockers, bounds source discovery with an explicit truncation flag and always returns `canDispatch=false`. Agent Server, checkpoint, scope/contract, runtime approval and paid authorization remain `NOT_PROVEN`; source metadata is not dispatch permission. Local PostgreSQL URL validation rejects malformed/remote addresses without echoing credentials, and supports validated IPv4/IPv6 loopback. Both scripts remain read-only and perform no migration or activation.

The instruction exporter now enforces exact manifest cardinality/unique source identities and source-path binding as well as existing revision/content hashes. Tests use isolated filesystem copies, reject missing/duplicate/foreign/corrupt mappings and preserve independent annotations. The legal exporter refuses regeneration after any actor/action/stage/reviewer/gold annotation or malformed review state. Canonical excerpts and hashes are unchanged. Review packages remain unapproved inputs, not loader manifests or approved gold.

Eleven instruction construction records moved solely because code lines moved. Their expression digests, source mappings and authority dispositions were matched exactly before updating coordinates. Strict inventory still passes: 59 entries, 354 construction sites, 19 framework surfaces. No maintained VI text, EN candidate or pending manifest was changed. Candidate manifest SHA-256 remains `78c60051168044a332364a0f7d2e43f7acf06228d46a77469683826d910c67e2`; deterministic paired-review package SHA-256 remains `50e773f16d5a7d4833265e5f9df7ab522033f2c45d079618285614da7d2061a2`.

## Actual environment and independent readiness gates

The original local snapshot was inspected again only inside `SET TRANSACTION READ ONLY`; no migrations or canonical writes. It still has two ACTIVE sources and lacks `ComplianceRuleSetVersion.targetActivityScope` and `RuleSetPreparationRun.targetActivityScope`. The user's selected newest source remains `ea43540c-513e-4b76-969a-8415f06696f2`, version `lcsp-360-official-eight-document-acceptance-corpus.v1`, structural identity `structural-integrity:038052812015ac771ec774cee86c0bb2ab7836e8ec1f0876489dd3195b71b664`. Selection does not change ACTIVE records or authorize a build.

| Gate                                                               | Evidence/status                                                                                                                 |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| Source and schema eligibility                                      | FAIL in existing snapshot; explicit blockers, no source change                                                                  |
| Strict instruction inventory/framework control                     | PASS, 59/354/19                                                                                                                 |
| Production loader negative boundaries                              | PASS in fresh unpatched subprocesses: missing/untrusted/pending/revoked/corrupt-pin/test-only approval/review-package rejection |
| Authentic approved runtime positive path                           | BLOCKED_EXTERNAL, 0/59 independent approvals; cutover NOT_RUN                                                                   |
| Legal gold                                                         | BLOCKED_EXTERNAL, 0/7 independently approved                                                                                    |
| Evaluation preflight                                               | Correctly BLOCKED_EXTERNAL_REVIEW_INPUT, exit 4, paidModelCalls=0                                                               |
| Provider/model                                                     | Configured Inception/mercury-3; actual compatibility, credential validity and quota NOT_PROVEN                                  |
| Monetary admission                                                 | Offline mechanics PASS; real tariff evidence, USD cap authorization and provider receipts BLOCKED_EXTERNAL                      |
| Input/output/physical attempt caps                                 | Offline mechanics PASS; no real pilot launched                                                                                  |
| Provider fallback                                                  | Unapproved policy/route blocks offline; pilot must authorize only the exact intended profile/credential                         |
| Resume                                                             | Old expired/exhausted/changed envelope cannot reset allowance; actual authorized resume NOT_RUN                                 |
| Source/scope/bundle/model identity as a complete diagnostic launch | NOT_PROVEN until approved environment/run/profile are frozen and checked together                                               |
| Authenticated deployment journey                                   | NOT_RUN; unchanged UI has focused mounted regression coverage only in this pass                                                 |

The USD 10 / 200,000 input / 65,536 aggregate output / 12 physical attempts / 12 logical calls / one build / 1,200-second DEVELOPMENT_ONLY proposal remains **unapproved**. Environment variables for logical calls/input alone do not create a financial hard cap. Do not start a model, switch to Claude, enable fallback or reset a ledger from this handoff.

## Focused verification receipts

Windows local execution; all provider paths are fixtures or mock transports, no live provider access. Dedicated PostgreSQL fixtures use only loopback 55438 database `lcsp347_localization_test`, verified before fixture writes. A read-only preflight through a second Prisma client rejects two actual ACTIVE test sources, then deletes only the owned test IDs. Existing history/RBAC/redaction tests remain intact.

- Python: `cd deepagents; uv run --frozen pytest -q tests/test_preparation_removal_authority.py tests/test_paid_admission.py tests/test_runtime_instruction_bundle.py tests/test_production_bundle_boundary.py tests/test_rule_set_preparation_governance.py tests/test_reviewed_eval_gate.py tests/test_preparation_semantic_eval_oracle.py tests/test_instruction_source_inventory.py tests/test_instruction_inventory_reconciliation.py` — 157 passed, zero failed/skipped. Receipt: `D:/FPT/lcsp347-hardening-python-delivery.log`.
- Final bounded repair-trace redaction check: `uv run --frozen pytest -q tests/test_preparation_removal_authority.py` — 8 passed, zero failed/skipped. Receipt: `D:/FPT/lcsp347-hardening-removal-final.log`.
- Additional actual review-artifact negative controls: `uv run --frozen pytest -q tests/test_production_bundle_boundary.py tests/test_reviewed_eval_gate.py::test_actual_unreviewed_legal_export_cannot_become_accepted_gold` — 8 passed, zero failed/skipped. Receipt: `D:/FPT/lcsp347-hardening-artifact-boundaries.log`.
- API: `pnpm --filter @lcsp/api exec cross-env NODE_OPTIONS=--experimental-vm-modules jest --config jest.config.ts --runInBand --runTestsByPath test/diagnostic-database.spec.ts test/preparation-preflight.spec.ts test/legal-review-guard.spec.ts test/preparation-observability.integration.spec.ts src/platform/runtime-events/preparation-activity-view.spec.ts src/platform/runtime-events/assessment-runtime-event.service.spec.ts src/modules/assessment/presentation/http/workspace-runtime-events.controller.spec.ts src/app.routes.spec.ts` — 65 passed, zero failed/skipped, eight suites. Receipt: `D:/FPT/lcsp347-hardening-api-delivery.log`. Existing pg concurrent-query deprecation warning remains; no test failure.
- Web: `pnpm --dir apps/web exec tsx --tsconfig tsconfig.test.json --test tests/preparation-observability.test.tsx tests/preparation-activity-bff.test.ts tests/localization-pagination.test.tsx` — 16 passed, zero failed/skipped. Receipt: `D:/FPT/lcsp347-hardening-web.log`. No frontend production code changed; no new browser/deployment acceptance claim.
- Review exporter: `node --test scripts/prepare-lcsp347-instruction-review.test.mjs` — eight passed, zero failed/skipped. Receipt: `D:/FPT/lcsp347-hardening-review-tests.log`.
- API TypeScript and changed-file ESLint completed; imports, contract literals, business documentation (zero missing/invalid), changed-file formatting, Python compileall and diff whitespace checks completed. No migration added.
- Scanner: checksum-verified Trustabl 0.1.16 `scan . --detectors mcp,langchain --no-progress --no-rules-update --json-out ... --sarif-out ...`; native exit zero and valid JSON/SARIF on both branches. Receipts under `D:/FPT/lcsp347-trustabl-*`; normalized findings are committed in `technical-remediation-evidence.json`.

## Handoff decision and restrictions

Confirmed code defects in this pass are repaired and covered. A newly green security check is not asserted: collect the full new check list after normal push, and have the maintainer/security authority resolve alert #139 if it persists. Do not alter security thresholds or dismiss it as part of this coding pass.

Environment work remains: provision a separate current-schema diagnostic environment with eligible pinned source/retrieval artifacts, compatible Agent Server/checkpoints, one preserved owned usage journal and validated provider/profile configuration. Do not migrate or retire sources in the original snapshot. Independent instruction equivalence/release approval, source-pinned legal gold, approved holdout/rubric, verified price evidence and explicit financial authorization remain external gates. Real-model semantic acceptance, quota, billing reconciliation and full authenticated EN/VI journey are NOT_RUN/NOT_PROVEN.

Paid model calls: **0**. Original snapshot/canonical source/accepted assessment mutations: **0**. Disposable test fixture writes: **yes**. Tests disabled, authority weakened, review approvals fabricated, PR marked ready, merge and deploy: **no**.
