# LCSP-360 Worker P simplification report

Historical worker snapshot. Later fixes and runtime acceptance are recorded in [takeover acceptance](LCSP-360-takeover-acceptance-report.md).

Status: **PASS within worker P ownership**. Remaining root harness references outside that ownership are listed below. No paid model calls, dev-database access, git staging/commits/pushes, deployment or memory writes were performed.

## Root cause

The file commit path called an independent model for each source node, often again at finalization. It persisted receipts and HMAC attestations, retried refusals, changed source accounting for declined nodes and sometimes retained old assertion wording merely to reuse a receipt. The file flow also shared the old per-node discovery tool surface and temporary discovery-mode branches.

## Fix

One native `task` claim-author assignment contains exactly one whole Điều source file and one existing-format claim JSON file. Native filesystem tools and framework context handling remain. `commit_claims` performs deterministic validation, applies the existing identity/support/relation operations and sends one API COMPLETE batch. A structural context file with no review units performs no empty COMPLETE request. An invalid claim file returns its grouped errors before any API call or draft mutation.

The second model, receipts, attestation, refusal counters, declined state, group/cascade/single-pass paths and exclusive model routes are removed. COMPLETE acceptance establishes committed authority. Finalization still requires durable complete review, exact source support, reference accounting, valid identity and structural integrity. Dated legal effects use committed source accounting. Rule Authoring, rejection repair, validation and submission continue against the frozen revision.

No claim-author route was added: its existing role lookup already resolves through the configured default. Provider fallback, failure policy, usage metering and AgentRunBudgetMiddleware are byte-identical to the starting WIP. Pause handling and startup reconstruction remain.

## Line counts

These counts compare the live starting WIP snapshot in `/tmp/lcsp-simplify-p-baseline`, not Git HEAD. The supplied pre-simplification archive was also checked: its claim_files.py matches the starting snapshot byte for byte.

| File                                                 | Before |   After |
| ---------------------------------------------------- | -----: | ------: |
| `deepagents/rule_set_preparation/claim_files.py`     |    783 |     509 |
| `deepagents/rule_set_preparation/claim_inventory.py` |    539 |     530 |
| `deepagents/rule_set_preparation/tools.py`           |    733 |     727 |
| `deepagents/rule_set_preparation/agent.py`           |    411 |     392 |
| `deepagents/rule_set_preparation/semantic_audit.py`  |   1438 | deleted |
| `deepagents/rule_set_preparation/claim_tools.py`     |    820 |     592 |
| `deepagents/rule_set_preparation/review_frontier.py` |    512 |     235 |
| `deepagents/rule_set_preparation/packet-schema.json` |   3429 |    1386 |

`review_frontier.py` remains solely as the existing deterministic persistence client needed by files and restart. Its NEXT acquisition, single-unit completion, expansion tool, lease scheduling and auditor paths are deleted. Retained operations are INIT/LOAD/PROGRESS/COMPLETE/REOPEN with source/frontier binding and dependency fingerprints. It is not a second discovery mode. The public per-node/per-claim tools are gone; the file adapter still reuses their necessary internal deterministic operations.

`canonical_support`, `FRAME_FIELDS`, `text_sha` and `utf16_slice` moved into claim_inventory.py, which owns their validation. semantic_closure.py uses its existing fingerprint function. No new runtime module, flag, route, cache, abstraction, fallback or dependency was added.

## Deleted files

28 files, 8,102 lines in total, including audit-only tests and harnesses. Counts are the starting WIP lengths; Worker E's 117-line report was recovered from the supplied pre-simplification archive for this accounting.

| Deleted file                                                     | Before lines |
| ---------------------------------------------------------------- | -----------: |
| `deepagents/rule_set_preparation/discovery_mode.py`              |            9 |
| `deepagents/rule_set_preparation/instructions.md`                |          269 |
| `deepagents/rule_set_preparation/legal_source_frontier_files.py` |          184 |
| `deepagents/rule_set_preparation/legal_source_reader.py`         |          108 |
| `deepagents/rule_set_preparation/semantic_audit.py`              |         1438 |
| `deepagents/rule_set_preparation/source_completeness.py`         |          362 |
| `deepagents/rule_set_preparation/source_concepts.py`             |           80 |
| `deepagents/tests/live_claim_discovery_harness.py`               |           71 |
| `deepagents/tests/review_frontier_harness.py`                    |          134 |
| `deepagents/tests/semantic_mutations.py`                         |           52 |
| `deepagents/tests/semantic_verifier_fixture.py`                  |           52 |
| `deepagents/tests/test_auditor_slot_contract.py`                 |          435 |
| `deepagents/tests/test_group_audit.py`                           |          157 |
| `deepagents/tests/test_no_progress_recovery.py`                  |          374 |
| `deepagents/tests/test_reference_dependency_liveness.py`         |          648 |
| `deepagents/tests/test_review_frontier.py`                       |          331 |
| `deepagents/tests/test_semantic_audit_neighborhood.py`           |           29 |
| `deepagents/tests/test_semantic_auditor.py`                      |          838 |
| `deepagents/tests/test_single_pass_exception_semantics.py`       |          634 |
| `deepagents/tests/test_single_pass_review.py`                    |          434 |
| `deepagents/tests/test_source_audit_recovery.py`                 |           87 |
| `deepagents/tests/test_source_completeness.py`                   |          659 |
| `deepagents/tests/test_source_concepts.py`                       |          138 |
| `deepagents/tests/test_source_semantic_fidelity.py`              |           42 |
| `deepagents/tests/vertical/real_group_audit_smoke.py`            |           97 |
| `deepagents/tests/vertical/real_single_pass_smoke.py`            |          302 |
| `deepagents/tests/vertical/runtime_preflight.py`                 |           21 |
| `docs/implementation/LCSP-360-worker-e-report.md`                |          117 |

Deleted symbol families include SemanticAuditor, audit_unit, receipt reconstruction/currentness/attestation, group prefetch and split receipts, omission tags/grounding, audit refusals and declined helpers, assignment environment knobs, discovery_mode, the exposed checking tool and the legacy per-node tool specifications. `check_claims` remains an internal deterministic function. The claim-file schema is byte-identical to the starting WIP. Packet-schema text outside its removed audit property is preserved byte for byte.

## Preserved and simplified behavior

- Unique verbatim source quotation resolves to original UTF-16 slices and hashes, including whitespace tolerance and safe locator correction. Half-surrogate boundaries and forged hashes fail.
- Every source-bearing Article locator requires claim support or a no-claim reason. An overlapping noClaims entry or an unknown locator now fails explicitly. Structural headings remain optional/auto-accounted.
- Every reference remains bound, explicitly non-material, UNRESOLVED_TARGET or REFERENCE_ONLY_TARGET. Circular files can commit together. Changed/deleted target claims invalidate dependents until an explicit file repair.
- Reference-only documents remain readable and excluded from assignments, accounting and the review denominator. Legal-effect targets can still refer to them.
- Changed assertion wording is persisted. The optimization that silently kept old wording for receipt reuse is removed.
- Both "Applicability is its own claim" and "State-addressed provisions are DUTY/PERMISSION" guidance remain. SCOPE/CONDITION are the applicability authority. Sources remain untrusted data.
- The existing JSON format and role/relation value sets remain. Native tasks, write_todos, source permissions, quota pauses, resume reconstruction, authoring convergence and actual validator/submission calls remain.

## Tests deleted versus kept

AST inventory, before pytest parameter expansion: **1,406 -> 1,218 test functions**. **193 obsolete functions deleted; 1,213 retained**, including nine renamed cases and four relocated quote/support cases. Five focused test functions were added for the changed file path (locator conflicts, native one-Article assignments and explicit fixture usage, commit payload/events, empty structural context, and changed/deleted target repair).

The 13 deleted test files contained 181 test functions. Four surviving quote/support cases were moved into test_claim_files.py: invalid/half-surrogate offsets, pinned hash support, original whitespace/UTF-16 provenance and overlapping repeated quotations. The other removed cases exercised the deleted auditor, receipts, refusals, lease scheduler or per-node model tool surface. Remaining mixed suites retain authoring, provider, usage, identity, freeze, source support, reference integrity and rejection recovery assertions. The exact Python/API semantic closure parity assertion now calls the surviving structural TypeScript function directly; it does not retain an audit bridge.

No surviving test was skipped to obtain a pass. The pure run naturally excludes ten explicitly DB-gated file cases; all ten ran in the disposable-DB suite. Eight pre-existing opt-in integration cases (external runtime/sandbox/checkpoint environments) were not enabled.

## Verification

All Python commands ran from `deepagents/` with the required environment isolation and `rtk proxy`.

```text
rtk proxy env -u DATABASE_URL -u REVIEW_FRONTIER_DATABASE_URL PYTHONPATH=.:tests \
  .venv/bin/python -m pytest -q --tb=short
1811 passed, 18 skipped in 127.98s (0:02:07)
```

The full-run log is `/tmp/lcsp-simplify-p-pytest-final.log`. Subsequent fixture/trace regression verification: **62 passed in 2.21s**; strengthened cross-runtime closure parity and artifact tests: **3 passed**. These are overlapping focused checks, not additional unique full-suite totals.

Worker B's report was observed before starting bridge verification. Disposable databases `lcsp-fbd-p-simplify-20261024` and `lcsp-fbd-p-final-20261024` used only `127.0.0.1:55449/lcsp_review_frontier_test`. Repository migrations, including B's removal migration, applied successfully. No command changed into the migrations directory.

```text
rtk proxy env -u DATABASE_URL \
  REVIEW_FRONTIER_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:55449/lcsp_review_frontier_test \
  PYTHONPATH=.:tests .venv/bin/python -m pytest \
  tests/test_claim_files_frontier.py tests/test_reference_only_claim_files.py -q --tb=short
14 passed in 3.28s
```

That suite contains ten DB-specific cases plus four pure reference-only parameter cases. It proves one COMPLETE batch, exact payload/graph fields, idempotency, file reconstruction, circular links, blocked publication/repair, committed wording updates, per-file events, durable endpoint invalidation after update/deletion, fail-closed finalize while dependents are incomplete and reference-only legal effects. Log: `/tmp/lcsp-simplify-p-db-final.log`.

```text
rtk proxy env -u DATABASE_URL -u REVIEW_FRONTIER_DATABASE_URL PYTHONPATH=.:tests \
  .venv/bin/python tests/vertical/discovery_files_eval.py \
  --out /tmp/lcsp-simplify-p-selftest3-20261024 --self-test
PASS: 18 scripted calls; 396 fixture tokens; 3 reviewed Articles;
CLAIM_INVENTORY_READY; zero Rule Sets; all 11 gates true.
```

This is synthetic plumbing evidence, not legal interpretation acceptance or live token/cost evidence. The live guard, --articles slice, reference-only seed, anchors, usage journal, HARD_CALLS=600, HARD_INPUT=12,000,000 and 10M-token watchdog remain. Two earlier self-test failures exposed an empty structural-file batch and incomplete fake usage metadata; the file no-op and explicit zero cache buckets were corrected. No usage gate or live threshold was weakened.

Additional checks: the new report passes Prettier; starting-content checks confirmed pre-existing formatting warnings in scripts/run.mjs, the historical design plan and Worker A contract, which were preserved. Python compileall PASS; `node --check scripts/run.mjs` PASS; scoped `git diff --check` PASS. No Python type checker is configured in this project. TypeScript typecheck/lint and API/web checks are worker B's scope, reported independently in its report.

AST-only `graphify update .` PASS with no model keys/calls. It reported 35,260 nodes, 61,005 edges and 12,540 communities at the final refresh. Existing limits remain: missing tree_sitter_sql leaves 131 SQL files unindexed; apps/api/test/smoke.e2e-spec.ts has a parse error at line 84; graph.html exceeds the visualization size limit and remains stale. No labeling/model run was requested.

The final Python runtime/test tree has zero references to deleted auditor/receipt/state/role/environment/legacy-tool symbols (the internal check_claims function is intentionally retained). No retired environment keys remain in .env/.env.example or the deployment launcher. Both explicit P databases and every evaluator-owned disposable database were removed. Final container inventory contains only the original Fogewise services.

## Not done and open risks

- No paid provider calls, full Luật 134 measurement, production Preparation, corpus mutation/activation, deployment or live pause/resume exercise. The owner will run the live measurement. Deterministic checks cannot establish the legal correctness/completeness of an author's judgment.
- No source edits in apps/** or packages/**. Worker B owns those changes, the receipt-removal migration and shared bridge protocols. B's report was the integration readiness signal.
- Root test harnesses are outside the enumerated worker P ownership and still need coordinator cleanup: `tests/admin-usage-analytics.mjs:43` and `tests/live-usage-recovery.test.mjs:19` use the retired role; `tests/compliance-rule-set-live-eval.mjs:28` requires the retired key; `tests/support/compliance-rule-set-stack.mjs:74,188` and `tests/staging-stack.py:167` still forward it. Remove those role/key assumptions before using those root harnesses. They were not run here.
- The earlier design plan was changed only by adding the requested "Superseded by simplification" section. Its historical body intentionally still contains obsolete names and flags. Worker E's audit-only report was deleted; the old Worker A report now points to this report; reference-only documentation keeps its surviving behavior.
- No unrelated optional Docker/runtime integration environments were started. No git add/commit/push/stash/checkout/reset or memory update occurred.
