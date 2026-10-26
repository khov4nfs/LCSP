# LCSP-360 takeover acceptance

Status: **release BLOCKED; PR #427 remains Draft**. The delivery correction below supersedes the final-acceptance/merge recommendation on commit `d56331804140834aec9abff7ce105a08c78f59d7`. Earlier focused recovery evidence remains historical evidence, not current release acceptance.

## Final delivery correction — 2026-10-26

### CI/security: root cause and fix

The [autofix run on d56331804](https://github.com/khov4nfs/LCSP/actions/runs/40260039928) failed. API lint reported 15 unsafe-any errors in `http-body-parser.spec.ts`; automatic formatting also left an uncommitted diff, so API/Web checks were skipped. The test now narrows parsed fields, types test responses and reads raw-body length only inside a `Buffer.isBuffer` guard. Changed API files receive the same lint/format fixes required by CI.

The [CodeQL check](https://github.com/khov4nfs/LCSP/runs/121370385412) failed with `Potential type confusion` at `http-body-parser.spec.ts:28`, where the test previously read `req.body?.length`. This is an unsafe test response projection, not an observed production parser exploit. The guarded Buffer access fixes the reported path; no suppression or alert dismissal is used. A successful Analyze job alone does not establish a successful aggregate CodeQL check.

The exact Python result was **2 failed, 1,885 passed, 22 skipped**. Both failures were in `tests/test_claim_inventory_protocol.py`:

- `test_rule_validation_no_progress_cannot_be_evaded_by_titles_or_progress_notes`: `DID NOT RAISE NoProgressDetected`.
- `test_callback_runtime_failure_is_not_mislabeled_as_claim_shape_error`: `DID NOT RAISE WorkerCallbackError`.

The inventory tool's serialization wrapper caught all exceptions and converted terminal control/callback errors into JSON feedback. It now catches only malformed-input errors (`TypeError`, `ValueError`, `KeyError`); runtime and callback errors propagate to their existing failure policy. Both original failing tests pass locally without changing their assertions.

Local correction checks: **1,892 Python tests passed / 22 skipped** in 148.48 seconds, **43 focused API tests passed**, **7 provider-free semantic oracle tests passed**, and changed-file API ESLint passed across 171 files. These results are local verification; external/database integrations skipped by pytest and fresh live semantic execution remain separate gates.

Full API typechecking also exposed the optional `semanticFrame` spread in `reference-only.spec.ts`: the known fixture frame must be non-null when extending it with a legal effect. The fixture now states that invariant, preserving the existing complete frame instead of inferring optional required fields.
API typechecking and its focused reference-only/legal-effect/parser rerun subsequently passed (23 tests, including the six parser cases already counted above).

The develop ruleset requires **Require Jira issue key**, **Docker sandbox E2E** and **V2 required release gate**, with strict current-base checks. The corrected candidate must run those checks, autofix and security checks on the same new commit. Old green checks on `95e2a0d` or `640d183f5` are not evidence for this candidate. Current completion evidence belongs in the existing [delivery comment](https://github.com/khov4nfs/LCSP/pull/427#issuecomment-6406994481) with its exact new SHA and run links.

### Separate acceptance denominators

The retained representative receipt reports active Rule Set `97004ff3-9240-4e37-8a94-9ade8832c00a`, 243 rules, four representative rules, 17 completed model calls, 716,360 input and 7,064 output tokens, and 51.27 seconds. These are retained historical measurements, not a fresh execution in this correction.

| Evidence                                 | Count | What it establishes                                                                                                         |
| ---------------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------- |
| Synthetic API contract fixture decisions |   239 | Submission/coverage/finalization plumbing using a manifest evidence reference; no semantic investigation of those rules.    |
| Representative AI decisions              |     4 | A real model investigated four selected rules in a controlled repository; semantic correctness must be reviewed separately. |
| Total persisted RESOLVED coverage        |   243 | 239 fixtures + 4 AI decisions. **Not 243 genuine investigations.**                                                          |

The six evidence records include one synthetic baseline record; they must not all be counted as AI-collected evidence. The harness now records fixture rule IDs before model execution and reports synthetic/AI decision and evidence counts separately.

### Semantic evidence: failed historical oracle, new regression gate

The historical representative trace accepted all four AI decisions as COMPLIANT. Direct source review refutes three positive verdicts: `src/auth.py` only checks identity/OTP string length and digits; `src/audit.py` returns a dictionary containing `retentionDays`; `src/data_log.py` returns a dictionary. Neither logging function persists its result. Accepted API decisions and COMPLETE lifecycle prove structural acceptance, not these semantic conclusions. The old `PASSED` receipt remains preserved and is not a semantic PASS.

The representative harness now requires NOT_MET/NON_COMPLIANT for the cosmetic authentication and logging cases. Outcome diversity alone is insufficient. Shared live-evaluation cases add these independent expectations:

| Regression                                                              | Expected result                                                                                                                                      |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| OTP format check without issued-challenge authentication                | NOT_MET / NON_COMPLIANT.                                                                                                                             |
| Audit object without persistence/retention                              | NOT_MET / NON_COMPLIANT.                                                                                                                             |
| Encryption implemented but required key separation absent               | The complete safeguard criterion is NOT_MET, overall NON_COMPLIANT; encryption alone cannot satisfy the combined duty.                               |
| Actual audience applicability cannot be established                     | No accepted decision; material human request remains OPEN and assessment is not COMPLETE. NOT_ESTABLISHED must not become REFUTED or NOT_APPLICABLE. |
| Input schema directly refutes the source-stated applicability condition | Referenced REFUTED basis, NOT_APPLICABLE, no criteria and no compliance verdict.                                                                     |

Agent instructions require tracing the implementation and callers to each source-stated effect, without inventing technical duties. The same regression oracle is invoked by `assessment-root-live-eval.mjs` and tested against deliberately false positive packets. Offline fixture/oracle tests establish that the acceptance gate rejects wrong results; they **do not establish that a live model now reasons correctly**. Fresh governed real-model execution and independent semantic review remain **NOT_PROVEN**. No paid rerun is authorized or performed by this correction.

### Budget governance and release boundary

The earlier cumulative table claiming 2,265 calls / 155,468,116 tokens / 348.73 minutes is a historical aggregate requiring reconciliation against run IDs and durable physical-attempt/usage records. It is not proof of an approved envelope, exact provider charges or zero unknown exposure. `direct_investigator_root.py` uses default production model governance (`governance=None`); callback call/input limits and an alarm do not by themselves prove run-scoped admission, retry/fallback accounting or settlement. The separate `live_root.py` harness explicitly uses `governance=()` and labels its billing exclusion; its semantic results cannot establish production budget governance.

Still required: reconcile approved run/envelope identities, restart/cumulative counters, physical provider attempts, failed/unknown usage, durable journal settlements and any financial ceiling claims. No cost or budget-governance PASS is inferred from successful finalization or completed-call token totals.

Release remains BLOCKED until same-SHA CI/security, genuine adversarial semantic evidence, budget reconciliation and applicable release/staging gates actually pass. No merge, production deployment or Draft removal is part of this correction.

### Follow-up CI integration and separate documentation workstream

The first corrective candidate was `b745022c6c4aea318fda611c441002a8894c89a2`. Its [Tests run](https://github.com/khov4nfs/LCSP/actions/runs/40267173276) exposed additional failures: 30 API integration cases, Web control-test module loading, an obsolete scripted Preparation driver in the Root vertical, and a rootfs policy false positive. Its Security workflow API coverage also failed on the integration fixtures. Its Python worker tests and API e2e gate passed; those results are not a green aggregate release gate. The remote CodeQL autofix commit `e64a99860116cb9949dfc67755db72294f4f5d11` was retained, but [CodeQL still failed](https://github.com/khov4nfs/LCSP/runs/121392758567). The final test projection uses `Buffer.byteLength` after Buffer narrowing rather than request-derived `.length`.

Develop integration resolved three conflicts without dropping the Preparation models or the upstream auth/isolation assertions. The imported MFA generation migration is additive and retains existing proof generation metadata; schema validation, client generation and fresh disposable migration replay were exercised locally. No production database was migrated.

API integration fixtures now advertise the execution contracts they exercise and send the typed Direct Draft and its CAS version through the real SourceReview/ClaimInventory handlers. The scripted worker uses the direct package/candidate tools for current runs, including the model-visible receipt after history compaction. It no longer asks the current runtime for retired discovery tools. Direct candidates own their AssessmentRule identity; the negative ownership fixture now tests attempted identity reuse. These synthetic fixtures do not establish independent legal quality or genuine investigations.

The Web controls load built security only when it is used, and the missing-authorization test targets the current live entrypoint. That entrypoint checks its frozen candidate before database/provider work. The rootfs auditor verifies the exact frozen terminology-policy bytes before excluding that policy's own forbidden-symbol literals; a changed policy and the same literal in runtime code still fail its self-check.

Local follow-up evidence: **38/38 API PostgreSQL cases**, **77 Preparation vertical checks**, **145 Assessment Root checks**, **79 same-thread HITL checks**, **72 unresolvable-fact checks**, **341 Web tests**, and **36 focused Python regressions** passed. The verticals use real migrated PostgreSQL/API/native graphs and scripted models; no paid provider calls. Seven oracle checks and rootfs mutation self-check also passed. These do not replace the final commit's remote checks.

The new business-logic documentation gate initially found **772** nonconforming functions across the PR (2,946 functions / 760 files scanned; baseline unchanged). The two serialization functions changed by this fix now carry compliant structured documentation. After also documenting the tool changed below, the refreshed inventory has **769** remaining violations. Project-wide adoption is a **separate workstream explicitly selected by the user**. Run `pnpm run check:business-logic-docs` to refresh its inventory and `pnpm run test:business-logic-docs` to validate the checker; the latter passes 5/5. Do not regenerate the fingerprint baseline, suppress the gate or mark release PASS while it remains unresolved. Final current-SHA remote results are recorded in the existing delivery comment.

### Security follow-up after current-base checks

On `bf05ce36197cca3e27a68f297db41e60f9e5f5cb`, all three CodeQL Analyze jobs passed and the [aggregate CodeQL check](https://github.com/khov4nfs/LCSP/runs/121399240819) reached **SUCCESS / no new alerts**. Its earlier NEUTRAL result was transient while the JavaScript analysis was pending, not a suppression or accepted release result.

The current-base [Dependency Review](https://github.com/khov4nfs/LCSP/actions/runs/40269519150) failed on three high-severity pypdf 6.21.1 advisories, including [GHSA-gmh7-3g9r-mjh5](https://github.com/advisories/GHSA-gmh7-3g9r-mjh5). Trivy also identified vulnerable locked filelock, FastMCP, checkpoint-postgres and setuptools versions. The targeted lock update selects pypdf 6.21.2, filelock 4.2.1, fastmcp/fastmcp-slim 4.1.2, langgraph-checkpoint-postgres 3.1.3 and setuptools 84.1.0, with the checkpoint/openapi-pydantic versions required by those packages. Direct dependency constraints now require the fixed pypdf/checkpoint-postgres versions. The lock resolves and remains consistent. After the update, the full local Python suite passed **1,892 tests / 22 skipped in 144.43 seconds**; the new public-tool schema/rejection regression separately passed 1/1. Final-head security checks must confirm the remote result.

Trustabl's separate aggregate annotation at `direct_draft.py:637` alleges that the variadic tool lacks a typed input schema. Source inspection shows `@tool(args_schema=SUBMISSION_SCHEMA)` already supplies the explicit JSON schema. A new regression inspects the actual provider tool conversion and invokes the public tool with malformed and corrected input, verifying rejection before persistence and successful corrected persistence. The variadic payload now also carries its explicit Python annotation, with structured business documentation; the provider input continues to use the full JSON schema, not an inferred variadic schema. This resolves the scanner assumption without weakening validation. The remote alert has not been dismissed, and final-head aggregate status must still be verified separately from scanner execution.

## Historical takeover checkpoint: repository and authority

The takeover started on `fix/LCSP-360-corpus-driven-applicability` at `3417d75682b9c645f6f792cad596987219db92f0`, with the existing implementation uncommitted. The starting patch, file hashes, previous disposable database and observed rows were preserved outside Git. PR #427 remains Draft. No production deployment or `lcsp_dev` lifecycle changes are part of this acceptance.

The selected source is the existing eight-document v4 corpus, copied with original blob/chunk hashes into owned disposable databases. Seven documents are OPERATIVE. Law 71/2025/QH15 is REFERENCE_ONLY: readable and available as a legal-effect target, without independent assessment obligations. The corpus has 1,798 retrieval chunks, 3,263 structural nodes and 2,863 required review units under the corrected Article-title policy. No pinned source was edited or removed.

## Duplicate requirements: root cause and fix

The surviving previous database contains 199 distinct requirement IDs and 32 rules for run `b799f091-fb8e-41c3-976c-8f463557ff38`, version `23f5cadd-cf81-4784-a70d-e00782d1824f`. This was a Law 134-only run, not acceptance of the full eight-document corpus.

Twenty-two groups contain 44 excess requirement rows. The repeated rows bind the same operative claim and have identical normative fields, applicability, exceptions, qualifiers, context, bindings and source references. They are not distinct legal obligations merely sharing wording. There are 155 unique normative representations among the 199 rows.

The groups contain 66 rows: 14 covered by AssessmentRules and 52 NON_ASSESSABLE. The defect therefore also affected assessed obligations.

The Python check protected new authoring calls but did not recheck requirements already present in a restored draft. The API's binding checks tracked duplicates within each requirement and collected owners in a set; they did not reject multiple requirement owners of one operative claim. The last successful authoring segment restored these candidates without creating new requirements. The available evidence establishes this acceptance hole; it does not identify the precise historical call that first created each extra candidate.

The existing semantic-claim integrity validator now rejects a second requirement owner through `CLAIM_REQUIREMENT_MISMATCH`. Shared modifier claims remain allowed. Python authoring keeps stable candidate keys, serializes mutations, accepts exact retries and returns bounded owner diagnostics. The same integrity contract protects restored drafts, validation and submission. The preserved 199-row packet produced 44 owner failures when checked against the corrected owner gate. Later Article-title coverage changes add a separate structural requirement, so that earlier diagnostic count is not a complete revalidation under every subsequent change.

The old output was structurally invalid under the corrected ownership contract. Its old PASSED/ACTIVE state does not establish legal validity; a comprehensive independent legal verdict was not performed.

## Durable authoring: root cause and fix

The original draft save was an unconditional snapshot replacement. A late writer or retry could overwrite newer candidates, and restart needed the exact frozen inventory rather than a newly assembled approximation.

The existing PostgreSQL draft now has a monotonic `draftVersion`. SAVE holds the run lock, validates the typed partial candidate maps, checks the exact run and inventory revision, and uses compare-and-swap. An exact replay after a lost response returns the accepted version without advancing it. Changed stale snapshots fail with `STALE_AUTHORING_DRAFT`. LOAD returns the stored version. The Python mutation lock spans authoring and persistence; each successful mutation is durable before its acknowledgement. Failed saves stay dirty and retryable. Validation failure keeps the draft. Freeze restoration verifies the stored graph, fingerprint and identities; an actual inventory reopen invalidates downstream authoring authority.

Focused tests cover concurrent stale snapshots, lost responses, invalid candidate keys and shapes, rejected saves/loads, revision changes, replay and flush before validate/submit/pause/error/shutdown. Migration `20261025090000_authoring_draft_version` is additive; fresh replay of all 133 migrations and upgrade of a clone containing the previous 199 rows were verified.

Real-model/API recovery evidence:

| Case                                         | Run                                    | Observed result                                                                                                                                                                                                        |
| -------------------------------------------- | -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Budget pause                                 | `7ece997e-6193-48de-b349-130edbc9b4dd` | Three acknowledged requirements at draft v3 survived Admin HTTP 202 resume unchanged; final v7, six requirements, one rule, PASSED/ACTIVE, zero duplicate owners.                                                      |
| Hard crash before local save acknowledgement | `8359ae14-791c-46de-98a9-f578d1aede2e` | Fault injector exited 73 after real HTTP SAVE committed v1. The same requirement JSON survived a new process and Admin HTTP 202 resume; final v9, six requirements, three rules, PASSED/ACTIVE, zero duplicate owners. |

The crash test used a cache-local fault injector, genuine model-authored candidates and the supported Worker failure API after worker death. It did not insert claims or mutate lifecycle rows directly.

## Source semantics and repair feedback

- Article titles can state the operative addressee. The old frontier excluded them while source support correctly refused claims owned by excluded nodes. Nonempty Article titles are now review units in both runtimes. A real Article 42 scope claim cites the title itself, without substituting an unrelated clause quote.
- Instructions preserve source-defined scope, triggers, OR/AND alternatives, exceptions, parent lead-ins, distinct clause branches and distinct permission/duty modalities. Native Agents make semantic decisions; deterministic checks protect source identity, support and relation structure. No second auditor, keyword classifier or fabricated assessment was introduced.
- Automatic release is limited to unreachable DEFINITION and CONTEXT claims. SCOPE, CONDITION, EXCEPTION, QUALIFIER, TEMPORAL_RULE and TRANSITION_RULE require explicit source-supported treatment.
- Unknown repeal targets retain `documentIdentifier`, `locator` and `reason`. Article 44's two out-of-corpus targets remain inspectable, with the source-stated date. Exact/subtree legal-effect tests preserve unaffected provisions rather than expiring a whole law.
- Nested schema errors now identify all invalid legal-effect target fields in one bounded response. Wrong support quotes return bounded pinned source text. Native filesystem errors use the existing argument fingerprint, so different repairs do not collapse into one global no-progress gap; unchanged repeated calls still stop.
- A full run exposed 108 missing-directory errors, all targeting valid but not-yet-created mirrored claim directories. Materialization now creates those empty operative workspace directories. It creates no candidates and preserves existing work. Native listing and reference-only exclusions are tested.
- Article 43 exposed a caller error: one 4,223-character explanation for all unresolved references was copied into 13 unit reasons, exceeding the API's existing 2,000-character limit. Waiting reasons are now deduplicated per owner and bounded in UTF-16 units; all reference IDs and claim facts remain intact. Replaying the retained real-model file passes HTTP validation without another provider call. The live harness now supplies the runner's existing retained-workspace argument, and terminal diagnostics retain the existing safe callback status/code.
- The same Article exposed misdirected citations: nested points inherited no external instrument because clause `title` was empty, although its source lead-in named the law being amended. The existing reference parser now follows explicit instrument identifiers through structural lead-ins. Parser revision `legal-structure-v5` creates new derived materializations; old pins remain readable. In the actual corpus, Article 43 changes from 19 RESOLVED/37 UNRESOLVED references to two cross-document RESOLVED/54 UNRESOLVED references, with no false local resolutions. A focused real-model/API run reviewed all 40 Article units, preserved 31 legal-effect claims, resolved two targets in reference-only Law 71 and retained 54 unresolved targets, with no rejected units or schema errors, then paused as configured.
- Provider errors retain their type across concurrent child calls. Provider cooldowns are honored. An explicit Admin resume can recover a failed MODEL_ERROR/RUNTIME_ERROR run while retaining valid reviews and drafts; terminal source/cancellation cases remain terminal.

The final focused Article 42/44 run `1e76628c-f71a-4f38-b0e1-10228b19a448` completed uninterrupted with eight of eight review units, 13 claims, six requirements, one rule, zero duplicate owners, zero missing-path errors, validator PASSED and API activation ACTIVE. Its 24 physical calls have complete accounting: 76,106 uncached input + 257,117 cached input = 333,223 inclusive input, 30,235 output, 363,458 total. Reasoning tokens (27,961) are included in output.

## Verification and cleanup

The Python suite passed 1,849 tests; 21 integrations were skipped in that process. The 13 database-gated discovery cases were exercised separately against owned PostgreSQL, leaving eight optional external integrations unchecked. Latest checks include 210 domain cases, 36 API/PostgreSQL cases, 12 Python frontier cases, eight resume-unit cases and 69 contract cases. Earlier isolated compliance-rule-set suites include the fresh lifecycle and reactivation databases. Full API TypeScript checking, source/test ESLint, API build, focused web/i18n and usage-recovery checks passed. The reference-dependency exhaustive test explored 1,085,691 states with no false deadlocks. Source graph updates ran with AST extraction only.

Deleted auditor/receipt/lease-scheduler tests were checked against the retained file/frontier tests: UTF-16 boundaries, ambiguous quotations, exact hashes, stable identities, cycles, changed-target invalidation, frozen authority, strict references, closures and no-progress remain covered. The captured historical tool-count fixture was restored unchanged. Active preparation code contains no retired auditor/HMAC tool references. Historical reports and applied migration history remain historical records.

The changed/untracked-file credential-pattern scan covered 204 paths with no credential matches. Private corpus exports, database dumps, fault injectors and model traces stay outside Git under `/home/khovan/.cache/lcsp360-takeover-20261025/`.

## Acceptance boundary and remaining evidence

The clean full-corpus run is pending: run `35aec286-f3da-4c02-8988-5876d5b7e43b`, database `lcsp360_final_clean_corpus8_20261025`. Failed or interrupted debugging runs are not clean reproducibility passes. Their valid reviews remain preserved, and unknown interrupted provider attempts are reported as unknown rather than assigned invented token totals.

The isolated HTTP harness starts the real built API, activates the real copied Legal Source and invokes the production outbox consumer seam. RabbitMQ transport is omitted from this harness. Focused browser verification covered English/Vietnamese activity views and responsive interaction; Chrome DevTools was unavailable. No production deployment, merge or independent model audit is claimed.
