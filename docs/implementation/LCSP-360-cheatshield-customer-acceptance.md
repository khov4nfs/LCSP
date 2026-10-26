# LCSP-360 — CheatShield Customer acceptance checkpoint

Release is **BLOCKED** and PR [#427](https://github.com/khov4nfs/LCSP/pull/427) remains Draft. This continuation resolved LCSP HEAD to `cef626d97f99bc8feef3139c426ae6b2b4475e1e` before editing. The results below are local isolated acceptance and regression evidence; new changes still require final-SHA remote checks. No merge, production deployment or Full-Corpus Preparation rerun occurred.

## Gate inventory

| Gate                                                | Result                        | Evidence and limit                                                                                                  |
| --------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Full-Corpus Preparation                             | Historical VERIFIED           | Existing 2,863/2,863 units, validated/activated Rule Set reused; no rerun.                                          |
| API contract fixture                                | Historical VERIFIED           | Prior 239 synthetic decisions establish contract plumbing only.                                                     |
| Prior representative investigation                  | Historical execution VERIFIED | Four model-authored decisions; three positive verdicts were independently refuted. Not semantic acceptance.         |
| CheatShield Customer setup and immutable provenance | VERIFIED locally              | Actual Customer API/auth/credential/connection/snapshot/setup lifecycle; all 13 pinned source files accounted for.  |
| CheatShield genuine AI investigation                | NOT PROVEN                    | Zero accepted decisions in the new Assessment; runtime is queued. No paid inference performed in this continuation. |
| Genuine semantic correctness                        | NOT PROVEN                    | Offline regression success and source review do not replace live reasoning.                                         |
| Full Customer E2E through report                    | NOT PROVEN                    | Investigation, material human dependencies, actual decisions and supported report lifecycle remain outstanding.     |
| Budget governance / Financial Gate                  | NOT PROVEN / BLOCKED          | Retained token receipts reconcile; approved envelopes, complete physical attempts and provider charges do not.      |
| Business documentation                              | FAILED                        | Workstream remains open; immutable baseline and scan policy unchanged.                                              |
| Staging / production release                        | NOT PROVEN / BLOCKED          | Disposable local services are not staging/production acceptance.                                                    |
| Codecov publishing                                  | NOT VERIFIED, nonblocking     | Existing upload reported `Repository not found`; artifacts/provenance are now retained independently.               |

## Real Customer setup and source identity

The execution-time GitHub REST resolution of `vishal017/cheatshield:main` returned commit `af4a55a86244f68d749d43b40f13678defdfff81`, tree `f624af750ff061be7542166ba8d7c440ae1c23e5`, repository ID `939532018`. A credential from the authenticated test operator was registered through the supported provider-credential API. GitHub reported pull access without push/admin access. No repository-owner impersonation, fabricated installation or upstream write was used.

The isolated API ran at loopback port 34471 against a canonical-migration clone of the existing acceptance database. The original Preparation database was queried read-only. The workflow used:

1. `POST /auth/sign-up` and `POST /auth/sign-in`.
2. `POST /assessments`.
3. Password reauthentication and `POST /provider-credentials` with the actual GitHub credential.
4. `POST /assessments/:id/repository-connection` for the external public repository.
5. `POST /assessments/:id/snapshots`, selecting `main` and the execution-time resolved SHA.
6. `POST /assessments/:id/repository-setup/complete` and authenticated Assessment retrieval.

No RepositoryConnection, RepositorySnapshot, AssessmentRuleDecision or coverage record was inserted manually. The application established:

| Identity                    | Persisted value                        |
| --------------------------- | -------------------------------------- |
| Assessment                  | `14a6d06e-e021-442e-a29e-0b5406e2b8fa` |
| Repository connection       | `ca24d435-e04a-4c75-b9a9-56235c605a47` |
| Repository snapshot         | `a2469b6b-d6d3-47a5-b1ac-0d65b3a351e3` |
| Repository hydration ticket | `df497dca-b7b7-43ac-8a58-5f4717705c0c` |
| Assessment Root thread      | `0dc89d04-eeef-40c4-bee3-9335df18b182` |
| Pinned ACTIVE Rule Set      | `97004ff3-9240-4e37-8a94-9ade8832c00a` |
| Pinned legal source         | `ea43540c-513e-4b76-969a-8415f06696f2` |

The Rule Set has 633 LegalRequirements and 243 AssessmentRules. All 243 coverage entries are PENDING, with zero accepted decisions. These counts must not be merged with the earlier 239-fixture/four-AI assessment.

The authenticated snapshot archive and an independently downloaded GitHub archive differ in tar-container bytes/root naming, but all 13 repository-relative regular-file SHA-256 values match. Snapshot archive hash is `42ea1bcc1cbdb35e2e94d91ba78e3e2b30f16df764f6fa6fb208f584ccccdd60`; independent codeload archive hash is `b77bb941f5174e8ab1adefc1ad8cb75e1e0970a084968e112b10fbbc81b99744`.

The production `sandbox_backend_factory` hydrated this Customer's server-owned thread using its actual snapshot ticket. Twelve materialized files match the pinned source. The remaining `models/best.pt` is 14,357,999 bytes, above the existing 10 MiB per-file safety limit. It is explicitly omitted, with source hash `833f6647667167064e7062e93cdd604798dea4e366f2aee8112df9c9d1b87474`. **The runtime source view is limited.** A hash identifies an omitted asset; it does not prove its behavior. This is model-free hydration evidence, not a claimed genuine Root investigation.

A second Customer could not read the first Assessment/setup or reuse its connection (404), and its repository listing did not expose that connection. Switching the ACTIVE Assessment to LCSP was rejected with 409. These API checks establish the exercised tenant/immutable-pin boundaries, without claiming every authorization path was tested.

The reproducible driver is [cheatshield-customer-acceptance.py](../../tests/cheatshield-customer-acceptance.py). It keeps credentials/session state outside the checkout with mode 0600 and requires an isolated loopback API. Its default setup/hydration path invokes no model. [Customer provenance receipt](../implementation-artifacts/lcsp360-cheatshield-20261026/customer-provenance.json) records hashes, runtime limitations and the API transcript.

## Runtime defects found and fixed

**Root cause:** `submit_final_report` filled omitted findings with `Baseline verified control ...`, producing unsupported positive report text. **Fix:** submit only Root-authored findings; the API's existing exact-coverage validator rejects incomplete reports. Instructions now require a finding for every decided rule and no automatic baseline narrative.

**Root cause:** the initial runtime context request ran outside execution settlement/heartbeat cleanup. **Fix:** move it into the existing guarded execution block so a context failure settles the claimed execution FAILED and stops heartbeat activity.

**Root cause:** safe extraction already marked oversized/link entries as limited coverage, but sandbox sanitization discarded that result. Cached source reuse also ignored Assessment/commit identity. **Fix:** carry omission paths, reasons, sizes and available source hashes into runtime-owned metadata and the Root context; check all reused pins. Upgrading a matching legacy marker writes metadata only and preserves repository/agent WIP. Existing archive limits remain unchanged. Conflicting pins fail closed before download.

Each defect was reproduced with a failing regression before its fix. The related Root/workspace/hydration tests now pass (59 cases); the full Python suite reports **1,901 passed, 22 skipped**. Separately, both real Docker sandbox E2E tests pass. Pytest skips do not constitute verified external integrations.

## Source review before genuine semantic execution

The pinned application is an examination-monitoring desktop program using camera, face detection, object detection, microphone analysis and exam controls. The following are independent source observations, not model-authored legal verdicts:

- `main.py` compares the exit dialog input with the hardcoded `SET_YOUR_PASSWORD`. That comparison does not establish securely managed operator authentication.
- MTCNN supplies face boxes/counts; this alone does not prove unique biometric identification or the legal applicability of biometric-data duties.
- `modules/audio_detection.py` records microphone input for YAMNet analysis. Actual deployment, audience, consent and jurisdiction remain Customer-owned facts.
- `modules/utils.py` contains a helper that appends to `violations.log`, but the inspected monitoring warning path displays/prints warnings and the code graph showed no callers of that helper. A genuine investigator must inspect the callers directly. A persistent helper alone does not prove the monitoring workflow meets logging, retention, access or deletion duties.
- README claims are context. Neither README nor public GitHub availability proves deployment in Vietnam, Vietnamese data subjects, organizational role, children using the service or operational compliance.

The prior OTP/return-object logging regressions remain distinct adversarial fixtures. They cannot be presented as observed CheatShield implementations or used to preselect verdicts on unrelated active legal rules. Live expected outcomes must follow the pinned legal requirements and actual observed behavior. Unknown material applicability must use the supported human-resolution lifecycle; it must not be forced to NOT_APPLICABLE or COMPLIANT.

The user explicitly authorized genuine CheatShield model execution without task-specific caps on 2026-10-26. Execution can now proceed using the configured real providers and fallback. No inference had been dispatched at this checkpoint before that clarification. Production provider routes and platform constraints remain in force; no scripted replacement investigation or artificial task-specific model cap was introduced.

## Retrospective Preparation accounting

[reconcile-preparation-usage.py](../../scripts/reconcile-preparation-usage.py) uses a read-only database transaction and optional read-only SQLite inspection. It never dispatches models or mutates historical settlement. [Accounting receipt](../implementation-artifacts/lcsp360-cheatshield-20261026/preparation-usage-reconciliation.json) retains the 14 request IDs/correlations and explicitly labels their timestamp-only associations.

For Preparation run `630eed1a-1577-4ca7-84bc-4ba17df911f1`, durable API data contains 2,281 unique invocation receipts: 2,265 SETTLED/COMPLETED, 15 UNAVAILABLE/FAILED and one UNAVAILABLE/OUTCOME_UNKNOWN. There are 2,265 unique retained provider response IDs and no duplicate retained invocation/response IDs. All retained receipts name INCEPTION / `mercury-3`; this does not prove there were no missing fallback/network attempts.

| Reported token dimension         | Known retained sum |
| -------------------------------- | -----------------: |
| Noncached input                  |         12,499,429 |
| Cached input                     |        133,912,421 |
| Input including cache            |        146,411,850 |
| Output                           |          9,056,266 |
| Reasoning, already within output |          8,833,545 |
| Total                            |        155,468,116 |

The 16 failed/unknown receipts have no established token usage. Missing visible-output and cache-write fields remain unknown, not measured zero. Reasoning is not added a second time to output/total.

There are 14 durable Preparation request/resume markers, but no retained per-attempt execution mapping in these receipts. Request timestamp windows are reproducible associations, not proof of exact session attribution. The current usage journal plus 26 retained archive journals supplied no matching run rows or envelope fingerprints. The API receipts carry no reservation, pricing, provider-cost or charged-credit identity. `SETTLED` here means a durable usage receipt, not verified financial settlement.

Known input exceeds the reviewer-reported historical 100,000,000 ceiling by **46,411,850**. The approved envelope governing those executions has not been established, so this remains an unresolved governance exception rather than a fabricated approval or a conclusive provider invoice. Provider statements/raw responses, the original run/envelope and complete physical-attempt history are still needed. Current admission code/tests cannot retroactively prove historical enforcement or that resume preserved that original ceiling. **Financial Gate remains BLOCKED.**

## Release verification still required

The business-documentation checker and its tests are now included in the V2 test job. Documentation is being migrated with executable AST/TypeScript equivalence checks; the implementation-fingerprint baseline has not been regenerated or expanded. Run the full checker to obtain the current remaining count; no partial wave constitutes compliance PASS.

Codecov upload remains optional and unverified. Coverage runs now explicitly check out the PR head SHA, record the actual Git checkout and LCOV digest, and retain the artifact independently of publishing. The observed `Repository not found` requires authenticated integration/account reconciliation; absence of a token alone is not a diagnosis because the workflow uses OIDC.

Before Draft removal: finish genuine CheatShield investigation and independent semantic review, preserve/resolve actual human dependencies, verify the report through supported lifecycle, reconcile historical accounting, reach zero non-baseline documentation violations, exercise applicable staging/recovery/integration gates, and obtain required CI/security on the final head. Production merge/deployment requires its own authorization.

## Continuation checkpoint — 2026-10-26 (SourceNerve)

This checkpoint documents a new continuation, **not a release PASS**. Local branch HEAD began at `eb06d84be2b736f81215e9da94f222a9389dd20e`, clean and ahead of the observed PR #427 HEAD `cef626d97f99bc8feef3139c426ae6b2b4475e1e` by two already committed changes. PR remained Draft and no merge or deployment occurred.

- Existing Root/repository hydration regressions: **59 passed**. The independent business-documentation checker tests: **5 passed**. Assessment decision-validator Jest: **37 passed** with the supported experimental VM-module environment. Full API compilation completed successfully. The three newly documented source files were compared against their original HEAD using TypeScript syntax-tree structure and literal values: **3/3 code AST equivalents**; no business implementation was changed.
- Structured documentation was added to the pinned-legal-source search terms/snippet/query, completion-gate source range/inspection, and deterministic decision/applicability validation (seven functions). The full checker improved from **506 to 499** non-baseline failures. The mandatory documentation gate **still fails**. The original fingerprint baseline and its checker policy were not modified.
- Existing historical GitHub workflows on `cef626d97` included successful Tests, Security and Quality, Dependency Review and autofix.ci runs. These are **not** same-SHA evidence for local `eb06d84be` or the subsequent documentation delta.
- SourceNerve protected Git mutation remains approval-gated; a push was requested but **not performed**. Any actual commit/push must pass its current exact-HEAD, focused verification and explicit one-shot approval controls.
- The isolated Customer API previously used at port 34471 was not running during this inspection. The reachable endpoint `http://127.0.0.1:8080/health` returned HTTP 502; this does not establish anything about a future isolated server. No Customer decision or provider inference was dispatched in this checkpoint; **genuine CheatShield semantic acceptance and report finalization remain NOT PROVEN**.
- The existing financial receipt still lacks an authoritative provider-side physical-attempt/envelope/charge match. **Financial Gate remains BLOCKED**. Codecov publishing, final-SHA CI, staging and full Customer report remain independently unproven.

Do not combine this checkpoint's local regression results with historical synthetic decisions or present it as RELEASE_READY.
