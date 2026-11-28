# LCSP-400 legal reasoning evaluation

Status: technical evaluation infrastructure with provisional annotations. Reviewed gold: **0**. Actual Preparation output imported: **0**. LIVE baseline: **NOT_RUN**. Legal metrics: **NOT_SCORED**. AC1-AC3 remain partial; LCSP-400 stays In Progress.

## Scope and current packages

Analyze the complete admitted Vietnamese source and retain relevant development, deployment, production and operational evidence. There are no alternative FULL_SOURCE/DEVELOPMENT_ONLY business modes. DEV/HOLDOUT are dataset splits; SCRIPTED/LIVE/OFFLINE_FIXTURE are execution modes. Evaluation checks identity, source bytes and recorded labels, not legal meaning. Root retains semantic authority; no production prompt, agent, domain enum or verdict writer changes are introduced.

The current `legal-score` defaults point to [`proposals.v2/`](../../deepagents/evals/legal_reasoning/proposals.v2/). It retains the 30 Assessment Root executable scenarios and 11 official provision references, but removes default actor/condition/exception/evidence/unsupported quality labels derived from fixture verdicts. Those dimensions are **unset until separately annotated**, rather than invented as CORRECT/COMPLETE/SUFFICIENT/NONE. Primary dimension is COMPLIANCE. Applicability/compliance fixture labels remain provisional proposals, never reviewed gold. The V1 annotation contract remains compatible; `proposals.v2` is a new immutable content revision, with its own candidate/cohort/map/split hashes and empty review overlay.

The two official sources are Law 134/2025/QH15 (PDF SHA-256 `181b8687613093eaf42d09af506999a22c7b13453ede8ef574ac48de2e1fdd1b`) and Decree 142/2026/ND-CP (`b2f71e9b86a878e4e91e0f59478b893f98a7db853112de66f3a7c58cbf392e18`). Source/version, exact locators, original provision bytes, receipt and corpus digests are validated against the checked-in LCSP-402 Cong Bao corpus. No foreign-law crosswalk is used.

Earlier root-level VN V1, GDPR and R1-R5 report artifacts remain historical snapshots, outside current defaults. New defaults must not be used to score an old manifest silently: pass every original package path explicitly when reproducing its report. The old generator behavior is preserved in Git at commit `73437c2c`, not used for new proposal quality labels.

## Source-grounded annotation review

Open [`source-review-frames.v1.json`](../../deepagents/evals/legal_reasoning/source-review-frames.v1.json). It is reproducibly generated from 15 **authored** clause frames and the verified original provisions, covering classification, dossiers, provider/deployer roles, changed-risk reclassification, notification, direct interaction, public authenticity disclosure, impersonation labeling, ongoing transparency, third-party lawful access, source-code exclusion, equivalent documents, retention, controlled export marking and open-system deployer marking. Each has two stated counterfactual fact scenarios (30 total), an exact source/actor anchor, action, material limit, original Vietnamese text and rationale. It never derives labels from LCSP output or documentary fixture verdicts.

These 30 review scenarios are **not 30 additional mapped/scored benchmark cases**. The executable proposal cohort still has four target rules and three semantic groups; the review frames increase annotation diversity, not measured executable coverage or generalization evidence. Quality labels still require independent annotation. No human reviewer identity or approval is generated.

The temporal frame fixes as-of `2027-10-01`, Law effectivity `2026-03-01` and Decree effectivity `2026-05-01`, linked to original Law Articles 34-35 and Decree Article 45. A reviewer must confirm first-operation date, sector, transition and any suspension facts. Structural validation rejects altered actor/action/condition declarations, source bytes, as-of/effective dates or counterfactual facts even after recomputing the package hash. **This does not independently confirm legal interpretation**; actor and temporal proposals remain candidates pending legal review.

From `deepagents/`:

```powershell
uv run python -m evals.legal_reasoning.provision_frames --output evals/legal_reasoning/source-review-frames.v1.json
uv run python -m evals.legal_reasoning.vn_ai_dataset --source-cases evals/legal_reasoning/p14-cases.vn-ai.v1.json --output-dir evals/legal_reasoning/proposals.v2
```

Reviewers inspect source clauses, the actual role, conditions, exclusions and known facts; confirm or revise expected outcomes and fill only dimensions they have independently assessed. Record legal-gold review in the single proposal `review-overlay.vn-ai.v1.json`, pinned to the candidate dataset and case hashes. A second reviewer records an independent decision when feasible. Disagreements remain provisional until an independent adjudicator resolves each affected dimension. Reviews of actual generated output are separate, bound to exact run/case/stage/trial/rule/trace/output identities. A fixed bad claim's label never becomes an expected error in an actual agent output.

## Official Vietnamese HITL vertical slice

[`official-hitl.v1/`](../../deepagents/evals/legal_reasoning/official-hitl.v1/) reuses exact official marking provisions and the frozen `UNVERIFIED` audiovisual-mark evidence in the workbench repository. It has one P14 case and two candidate observation IDs: WAITING_FOR_HUMAN (known applicable obligation, insufficient evidence) and RESUME_FINAL (explicit simulated verification answer). It uses the existing P14 runner, genuine runtime request creation and confirmed-fact resolution. The simulated answer is an engineering fixture, not an actual human review.

The adapter admits a genuine open request without a final decision as reviewer-usable UNRESOLVED output. It preserves raw verdicts and requires output-bound human judgment for the semantic INSUFFICIENT_EVIDENCE distinction. Resumed output must preserve request/rule/answer/fact and prior-trace linkage. A changed answer, wrong rule or unrelated fact is rejected even with a recomputed output digest. Separate candidate IDs permit two lifecycle observations for one P14 case without duplicate case/stage mappings.

```powershell
uv run python -m evals.legal_reasoning.official_hitl --output-dir evals/legal_reasoning/official-hitl.v1
$base = "evals/legal_reasoning"
$work = Join-Path $env:TEMP "lcsp400-official-hitl-verification"
$commit = git rev-parse HEAD
uv run python -m evals.cli run --cases "$base/official-hitl.v1/cases.json" --mode SCRIPTED --split ALL --trials 1 --k 1 --run-id lcsp400-official-hitl --git-commit-sha $commit --output-dir $work --evaluation-split-manifest "$base/official-hitl.v1/split.json"
uv run python -m evals.cli legal-score --manifest "$work/lcsp400-official-hitl/manifest.json" --trials "$work/lcsp400-official-hitl/trials.jsonl" --p14-cases "$base/official-hitl.v1/cases.json" --candidate-cases "$base/official-hitl.v1/candidates.jsonl" --case-map "$base/official-hitl.v1/map.json" --shared-cohort "$base/official-hitl.v1/cohort.json" --evaluation-split-manifest "$base/official-hitl.v1/split.json" --review-overlay "$base/official-hitl.v1/overlay.json" --output "$work/legal-reasoning.json"
```

## Preparation import and external artifact dependency

`evals.legal_reasoning.preparation_adapter` accepts a frozen LCSP-402 output and manifest, an externally pinned output digest, independently approved LCSP-402 gold and its external digest, P15 Preparation annotations/rubric and exact output-bound human judgments. It reuses LCSP-402 `reviewed_eval_preflight` for existing artifact provenance and P15 `score_dataset()` for stage-specific metrics. It does **not** invoke the legacy development-scope classifier or use generated output as gold. Legacy manifest/gold metadata is a compatibility contract, not a selectable business mode.

Exact manifest/output/claim/source/provision/instruction/skill bindings are required. Supply the frozen Preparation source graph with `--source-graph`; its byte digest must be recorded as `sourcePins.sourceGraphSha256` in the run manifest. Each claim's `sourceNodeIds` must resolve through that graph to the selected original document and article, and the cited node content must occur in the pinned original provision bytes. An unrelated article fails even when the claim, source graph, manifest and output are all consistently rehashed. The manifest must also bind the official corpus and document PDF hash. Source-version correspondence must be explicit; an internal version ID cannot silently stand for a different official source pin. An unavailable mapping needs separately reviewed correspondence. Structural provenance never authenticates reviewers or proves actual model execution.

No frozen actual source-backed Preparation output was supplied or found in checked-in evaluation assets. Therefore **actual Preparation integration remains open**. The importer returns explicit NOT_SCORED blockers, without fabricating a baseline:

```powershell
uv run python -m evals.legal_reasoning.preparation_adapter
# After genuine frozen files and independent review are available:
uv run python -m evals.legal_reasoning.preparation_adapter --output-artifact <frozen-output.json> --manifest <run-manifest.json> --source-graph <frozen-source-graph.json> --gold <independent-lcsp402-gold.json> --approved-gold-sha256 <external-approved-digest> --expected-output-sha256 <external-frozen-output-digest> --annotations <p15-reviewed-preparation.jsonl> --judgments <output-bound-judgments.json> --rubric <preparation-rubric.json>
```

## Split-aware scoring and metric integrity

The full canonical dataset/map digest is distinct from the execution subset digest. New manifests retain signed runConfig bytes. The adapter checks config, frozen split, exact case/stage/trial inventory, repository tree, legal/rule/HITL/gold digests and observed trace/output bytes. Historical config-less manifests are permitted only as full canonical ALL executions. Out-of-split cases are not counted as missing. Missing outputs within executed targets remain errors; unexecuted intended targets remain visible.

DEV/HOLDOUT metrics are separate per target/lifecycle/trial in `rubricReportsBySplitTargetAndTrial`. Primary macro-F1 uses legitimate rubric classes with gold or prediction support, excluding missing/unknown sentinels as classes while keeping them as errors/FNs and matrix columns. Zero denominators yield NOT_SCORED and null quality metrics. Semantic and evidence dimensions remain separate. Repeated trials are not implicitly aggregated. Only structurally eligible reviewed/adjudicated gold and required output judgments enter scoring. Structural identity references do not authenticate reviewers; seeded and synthetic reviews cannot enter actual review paths.

Standalone `score_dataset()` remains diagnostic/unverified. Adapter artifact validation and SCRIPTED/LIVE mode cannot set `verifiedSemanticMetrics` or nested `verifiedExecutionMetrics` true. Label arithmetic, artifact integrity and reviewer authenticity remain distinct; no legal-quality or generalization claim is supported by the current small, unreviewed cohort.

Repository fixture lookup normalizes Windows separators for POSIX runners while preserving the exact serialized repository pin and its digest. This also permits retained Windows-generated artifacts to be validated on Linux. A POSIX-path regression confirms that lookup normalization does not rewrite artifact identity.

The source/cohort snapshots were originally pinned against Windows CRLF packaging bytes. Scoped Git attributes now preserve those exact bytes for the 11 hashed evaluation metadata/evidence files, instead of converting them into different LF bytes on Linux checkout. This is a packaging-only change: JSON values, PDF originals, legal text, review labels and all existing pin values remain unchanged. The original ingestion receipt's manifest reference remains its historical ingestion reference. A regression compares committed Git blob bytes with the files actually read by the evaluator; byte pin validation is never replaced with newline-insensitive hashing.

```powershell
$base = "evals/legal_reasoning/proposals.v2"
$work = Join-Path $env:TEMP "lcsp400-current-splits"
$commit = git rev-parse HEAD
foreach ($split in @("ALL", "DEV", "HOLDOUT")) {
  $runId = "lcsp400-current-$split"
  uv run python -m evals.cli run --cases "$base/p14-cases.vn-ai.v1.json" --mode SCRIPTED --split $split --trials 1 --k 1 --run-id $runId --git-commit-sha $commit --output-dir $work --evaluation-split-manifest "$base/evaluation-splits.vn-ai.v2.json"
  uv run python -m evals.cli legal-score --manifest "$work/$runId/manifest.json" --trials "$work/$runId/trials.jsonl" --output "$work/$runId/legal-reasoning.json"
}
```

## Retained evidence and checks

R5 full run bytes are now committed in [`reports/r5/full-artifacts.zip`](../../deepagents/evals/legal_reasoning/reports/r5/full-artifacts.zip), with archive and per-file hashes in `full-artifacts.index.json`: 75 JSON/JSONL/CSV files covering ALL 30 / DEV 22 / HOLDOUT 8. Extract to a fresh directory, verify file hashes, then pass each manifest/trials and the historical root-level V1 package paths to the adapter. The compact receipt alone is not artifact validation.

R6 retains [full artifact bytes](../../deepagents/evals/legal_reasoning/reports/r6/full-artifacts.zip), [per-file hashes](../../deepagents/evals/legal_reasoning/reports/r6/full-artifacts.index.json) and a [verification receipt](../../deepagents/evals/legal_reasoning/reports/r6/verification.v1.json), bound to implementation commit `d1034be21c3eb7382ff43c78d7e243fed858fb89`. The archive has 82 files, SHA-256 `2f709f2bb3b0e9f34008f4e2b420adce7f941547148217ca560d416dfa6f9196`. Proposal runs executed ALL 30 / DEV 22 / HOLDOUT 8 distinct cases. The official HITL run executed **one distinct P14 case and two lifecycle observations**, with OPEN then RESOLVED request state, zero missing output and validated prior-trace linkage. Adapter cohort counts use candidate observation IDs, so its count of two is not two distinct P14 cases. Every legal report remains NOT_SCORED, reviewed denominator zero.

Raw SCRIPTED fixture verdict mismatches are retained: ALL 24/30, DEV 18/22, HOLDOUT 6/8; no execution errors. The official HITL fixture passed both lifecycle expectations. These are scripted behavior diagnostics against provisional expectations, not measured Deep Agent legal accuracy; the broader proposal labels and outputs still require independent review. No labels or production behavior were changed to improve these counts.

Final PM regression: 13 passed. Relevant earlier combined evaluation regression: 74 passed; rubric/hardening/manifest regression: 41 passed. Additional RSP/Discovery/Root completion checks: 11 passed, one pre-existing `scannerSignature mismatch`. That same Discovery failure was reproduced from develop `fa90c435`; canonical develop RSP fixtures passed all four tests. The historical 1,205 versus 1,185 source-length failure was reproduced as Windows archive CRLF conversion: the original Git blob and branch file are both 1,185 LF bytes with the pinned SHA-256. Restoring exact Git blob bytes in the temporary develop test export made all RSP tests pass. No fixture hash, expected length or production scanner was changed. CI for the final pushed head must be checked separately.

Fixture-path compatibility regression: one additional POSIX-path test passed. RAG/retrieval compatibility suites had 11 passed and four failed on both branch and develop export (repository/tree pin mismatches and B1 evidence-span matching). These failures are recorded in the receipt, not concealed as passing checks; no unrelated production or pinned-fixture change was made.

The combined nine-suite run subsequently passed **117 tests**. After the portable lookup change, the complete PM regression passed **14 tests**. The byte-packaging correction adds a committed-byte regression; its result and exact-head CI status are published on the PR.

```powershell
uv run pytest tests/test_legal_reasoning_pm_followup.py tests/test_legal_reasoning_p14_integration.py tests/test_legal_reasoning_vietnam_p14_integration.py tests/test_reviewed_eval_gate.py tests/test_preparation_semantic_eval_oracle.py tests/test_evals_benchmark.py -q
uv run pytest tests/test_legal_reasoning_rubric.py tests/test_legal_reasoning_r2_hardening.py tests/test_run_manifest.py -q
```

## PM findings and honest remaining gates

| Finding | Technical work and remaining evidence |
|---|---|
| Split-aware scoring / metric provenance | Previously accepted at static review; retained with negative/positive regressions and no review-authenticity inference. |
| Actual Preparation integration | Frozen-artifact importer now resolves claim source nodes to pinned original document, article and bytes, including a cross-provision negative control. No actual output/manifest/source graph or independent gold exists in the available assets; actual stage coverage remains open. |
| Candidate quality/diversity | Default heuristic quality labels removed; 15 original-clause review frames and 30 material counterfactual scenarios supplied. These are not executed benchmark cases or confirmed gold; independent dimension annotations and wider executable coverage remain open. |
| Actor/effectivity | Source/actor/action/date declarations and negative mismatch controls implemented. As-of/transition interpretation still requires independent legal review and cannot be confirmed by hashes. |
| Official VN HITL | Source-pinned real SCRIPTED request/resume with missing evidence, explicit simulated answer and output/fact bindings implemented. No actual human decision or LIVE reliability claim. |

No new paid/LIVE execution was authorized. Future LIVE execution requires an approved route/budget, fixed admitted source/repository/manifest/rubric/split, genuine reviewed legal annotations, output reviews, errors/usage/cost receipts and production prompt/skill fingerprints. Do not mark original Jira acceptance criteria complete or request blanket merge approval while the above implementation/research evidence is missing.
