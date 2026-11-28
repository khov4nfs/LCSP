# LCSP-400 legal reasoning evaluation

**Round:** `LCSP_400_PM_REVIEW_RESOLUTION_AND_FINAL_DELIVERY_R3`
**Active dataset:** `LCSP-400-VIETNAM-AI-CANDIDATES-V1`
**Rubric:** `LCSP-400-LEGAL-REASONING-RUBRIC-V1`
**Status:** implementation and SCRIPTED artifact verification only; no human-reviewed gold and no live baseline.

## Scope and evaluation targets

This evaluation layer keeps legal reasoning quality separate from evidence quality. It does not change Rule Set Preparation, Assessment Root, Researcher, production verdicts, or production statuses. Deterministic checks validate identity, provenance, and contract shape; they do not interpret the law. LegalBench is methodological inspiration only; no LegalBench data or labels are used.

The active default P14 scoring package is the 30-case Vietnamese AI law cohort:

- [`candidate-cases.vn-ai.v1.jsonl`](../../deepagents/evals/legal_reasoning/candidate-cases.vn-ai.v1.jsonl): provisional legal facts and expected outcomes, bound to source provisions, scenario facts, P14 case, target rule, repository evidence snapshot, stage, lifecycle, and split.
- [`source-pins.vn-ai.v1.json`](../../deepagents/evals/legal_reasoning/source-pins.vn-ai.v1.json): 11 exact provision references in two official Cong Bao sources: [Law 134/2025/QH15](https://congbao.chinhphu.vn/van-ban/luat-so-134-2025-qh15-468694/61695.htm) and [Decree 142/2026/ND-CP](https://congbao.chinhphu.vn/van-ban/nghi-dinh-so-142-2026-nd-cp-469480.htm). Their PDF SHA-256 pins are `181b8687613093eaf42d09af506999a22c7b13453ede8ef574ac48de2e1fdd1b` and `b2f71e9b86a878e4e91e0f59478b893f98a7db853112de66f3a7c58cbf392e18`, respectively. Provision text and PDF hashes are revalidated against the LCSP-402 corpus and ingestion receipt.
- [`p14-case-map.vn-ai.v3.json`](../../deepagents/evals/legal_reasoning/p14-case-map.vn-ai.v3.json) and [`p14-shared-cohort.vn-ai.v2.json`](../../deepagents/evals/legal_reasoning/p14-shared-cohort.vn-ai.v2.json): explicit exact mappings. Independent valid pins do not prove correspondence. The adapter checks jurisdiction, source identity/version and bytes, provisions, target proposition/rule, material scenario facts, repository snapshot, stage/lifecycle, and split. It rejects mismatches; it does not infer legal equivalence.
- [`evaluation-splits.vn-ai.v2.json`](../../deepagents/evals/legal_reasoning/evaluation-splits.vn-ai.v2.json): 60 entries grouped by semantic group before split assignment (44 DEV, 16 HOLDOUT; 2 DEV and 1 HOLDOUT groups). Digest: `b00e10fda753bd92b563625b05552af13ea18eb779939107b48d8755f15eb851`. The cohort is too small and synthetic to support generalization claims.
- [`review-overlay.vn-ai.v1.json`](../../deepagents/evals/legal_reasoning/review-overlay.vn-ai.v1.json): canonical review lifecycle overlay; currently empty.

The active candidate and P14 mapping artifacts can be regenerated without model calls from the pinned LCSP-402 fixtures. P14's policy-baseline command writes the source case snapshot to a temporary directory; the cohort builder then emits the versioned LCSP-400 artifacts:

```powershell
$work = Join-Path $env:TEMP "lcsp400-vn-candidate-generation"
uv run python -m evals.cli policy-baseline --output-dir "$work/policy"
uv run python -m evals.legal_reasoning.vn_ai_dataset `
  --source-cases "$work/policy/cases.json" `
  --output-dir evals/legal_reasoning
```

The earlier 30-case GDPR dataset remains available as an immutable historical candidate package (`candidate-cases.v1.jsonl`, `rubric.v1.json`, `source-pins.v1.json`) and fixed-claim diagnostics. It is not the default scoring dataset. GDPR and Vietnamese law are never cross-mapped. Fixed negative-control labels describe supplied claims only and cannot penalize an LCSP output that correctly avoids those claims.

The VN cohort's expected labels are candidates based on the separately authored LCSP-402 fixture reference, pinned official provisions, and exact scenario evidence. They remain provisional. SCRIPTED outputs were not used to create expected labels. No qualified reviewer has confirmed the legal labels. LCSP-402 Preparation output is not included: no genuine frozen Preparation output artifact was available; P14 executions exercise Assessment Root only.

## Review and metric integrity

The schema and full label definitions/examples are in [`rubric.vn-ai.v1.json`](../../deepagents/evals/legal_reasoning/rubric.vn-ai.v1.json) and [`annotation.schema.vn-ai.v1.json`](../../deepagents/evals/legal_reasoning/annotation.schema.vn-ai.v1.json). The scorer does not interpret legal prose or call an LLM. Explicit Assessment Root categorical verdicts are normalized only through documented contract mappings. Actor, conditions, exceptions, evidence quality, and other semantic distinctions not expressed by production fields require a separate judgment bound to the exact output.

Legal-gold review and observed-output review are distinct. To review legal gold, inspect candidate facts, expected labels, source citations, and provisions, then record reviewers and any adjudication in the single overlay. To review an output, bind each judgment to the exact P14 manifest, run, case, trial, stage/lifecycle, target rule, trace bytes, and observed-output digest. Review trials separately. A second reviewer records an independent decision when feasible; an independent adjudicator resolves disputed dimensions. Unresolved or unconfirmed dimensions remain provisional. Reviewer IDs and references are structurally checked but do not authenticate people. Seeded P14 reviews and synthetic test reviews never qualify as actual human review.

Main metrics use only eligible reviewed gold and required output-bound human judgments. Missing/unknown predictions remain errors, not dropped rows. The primary macro-F1 averages legitimate rubric classes; missing and unknown remain visible in the matrix, coverage, and false-negative accounting. Zero reviewed denominator or zero executed eligible cohort yields `NOT_SCORED`, not a fabricated score. Semantic and evidence metrics remain separate. Repeated trials are reported separately; there is no implicit aggregation.

## P14 execution and artifact workflow

The integration uses P14's real runner and existing `legal-score` command. P14 `SCRIPTED`, `LIVE`, and `OFFLINE_FIXTURE` remain distinct. SCRIPTED mode executes the real evaluation runner without a model call and verifies the nonempty cross-bound cohort; its output is an engineering diagnostic, not Deep Agent accuracy. The adapter validates the saved manifest, `trials.jsonl`, trace bytes, observed-output digest, outcome binding, case/source/rule/repository pins, HITL requests/resolution, and lifecycle history before normalizing output. A changed trace/output digest or mismatched outcome is rejected. Missing output from an executed trial is counted as an error; targets never executed remain `NOT_EXECUTED`.

Run from `deepagents/` to reproduce the nonempty offline SCRIPTED path. The run ID should be unique for a new run:

```powershell
$base = "evals/legal_reasoning"
$runId = "lcsp400-r4-vn-ai-scripted-final"
$runRoot = "$base/reports/r4/vn-ai-scripted-final"
$commit = git rev-parse HEAD
uv run python -m evals.cli run `
  --cases "$base/p14-cases.vn-ai.v1.json" --mode SCRIPTED --split ALL --trials 1 --k 1 `
  --run-id $runId --git-commit-sha $commit --output-dir $runRoot `
  --evaluation-split-manifest "$base/evaluation-splits.vn-ai.v2.json"
uv run python -m evals.cli legal-score `
  --manifest "$runRoot/$runId/manifest.json" `
  --trials "$runRoot/$runId/trials.jsonl" `
  --output "$runRoot/legal-reasoning.json"
```

The current checked-in run is [`reports/r4/vn-ai-scripted-final/`](../../deepagents/evals/legal_reasoning/reports/r4/vn-ai-scripted-final/). It used run ID `lcsp400-r4-vn-ai-scripted-final`, source code commit `be290851ee8b20d2cabe1d0690688e54188ca0c0`, and P14 manifest SHA-256 `55ebae6585dd0d290b27bfdf60972b6f96a6f0d33128bd9cf368d77b59db91d1`. The legal report SHA-256 is `2c8c8c3adccc5cab06817ad669cec42bc7282db33d1ed0920c566ae80673b85e`; it pins candidate dataset `aa35124bb96c169ce237d9194c6a9f9bc8e22e86f9b3e303e214841ed2074a5d`, map `2f5af404d790d1ffc3709912595e4f10a533618166d3d18f36f0b1178ed09129`, source pins `ce0cd1380e5e4becf9e1e56919a2e7c9bf5abd486f39809a1b0bbbdfa8ff24e5`, cohort `8b8e1c53428ec282b8bb2275b4b22c86da9a8a65536662ce20ac6240aa5675a5`, and split `b00e10fda753bd92b563625b05552af13ea18eb779939107b48d8755f15eb851`. The real P14 runner produced 30 mapped cases, 30 executed trials, and 30 digest-validated observed outputs; lifecycle labels were `INITIAL` (29) and `WAITING_FOR_HUMAN` (1), with no missing outputs. All observed HITL states in this cohort were `NONE`; the WAITING_FOR_HUMAN lifecycle label did not contain an open or resolved human request. The report has zero reviewed gold and `scoringStatus: NOT_SCORED`. P14's generic SCRIPTED task score is not a legal quality metric. `actualExecutionStatus` describes SCRIPTED artifact execution; `actualExecutionBaseline` remains `NOT_RUN` because no authorized LIVE model execution is available.

The zero-mapping and partial-mapping negative controls remain in `tests/test_legal_reasoning_vietnam_p14_integration.py`. Run both with the nonempty SCRIPTED runner fixture:

```powershell
uv run pytest tests/test_legal_reasoning_vietnam_p14_integration.py::test_nonempty_scripted_artifacts_integrate_and_empty_or_partial_mapping_stays_unscored -q
```

Run the standalone fabricated-provenance diagnostic and the full LCSP-400 focused regression with:

```powershell
uv run pytest tests/test_legal_reasoning_r2_hardening.py::test_standalone_scoring_cannot_promote_fabricated_p14_provenance_to_verified -q
uv run pytest tests/test_legal_reasoning_rubric.py tests/test_legal_reasoning_r2_hardening.py tests/test_legal_reasoning_p14_integration.py tests/test_legal_reasoning_vietnam_p14_integration.py -q
```

For a future authorized live baseline, first obtain genuine legal-gold review, output review, and explicit approval for a model route. From `deepagents/`, execute a unique run ID and score its exact saved artifacts:

```powershell
$base = "evals/legal_reasoning"
$runId = "lcsp400-authorized-live-<unique-id>"
$runRoot = "$base/reports/authorized-live"
$approvedModelRoute = "<approved-route>"
$commit = git rev-parse HEAD
uv run python -m evals.cli run `
  --cases "$base/p14-cases.vn-ai.v1.json" --mode LIVE --split ALL --trials 1 --k 1 `
  --model-route $approvedModelRoute --allow-live --run-id $runId `
  --git-commit-sha $commit --output-dir $runRoot `
  --evaluation-split-manifest "$base/evaluation-splits.vn-ai.v2.json"
uv run python -m evals.cli legal-score `
  --manifest "$runRoot/$runId/manifest.json" `
  --trials "$runRoot/$runId/trials.jsonl" `
  --output "$runRoot/$runId/legal-reasoning.json"
```

No authorization for LIVE was given in this round.

## PM review resolution record

- **PM01:** P14 SCRIPTED/LIVE trace and output contract is validated against actual saved artifact bytes and outcome bindings; no alias of `runResult` to output.
- **PM02:** official-source mappings require exact immutable source/provision, claim/rule, scenario, repository, lifecycle, and split correspondence. No GDPR/Vietnam crosswalk is used.
- **PM03:** raw categorical verdict, normalized prediction, bound human judgment, and gold outcome remain separate; human review cannot overwrite a contradictory categorical verdict.
- **PM04:** P14 output, Rule Set Preparation output, and fixed-claim diagnostic judgments use distinct target bindings. No frozen LCSP-402 Preparation output was available for import.
- **PM05:** mapping, execution, missing-output, reviewed-gold, prediction, and scoring coverage are reported separately. Zero mapping and unexecuted cases cannot become scored.
- **PM06:** DEV/HOLDOUT membership is pinned by group and manifest digest; counterfactual and materially related cases remain grouped. Do not tune on HOLDOUT.
- **PM07:** standalone `score_dataset()` is diagnostic/unverified. Verified execution reporting requires the P14 adapter to validate actual manifest, trace, output, and outcome bytes. Artifact integrity does not authenticate reviewer identity or establish live quality.

The earlier GDPR and three-case synthetic engineering reports remain historical. Do not combine them with the official VN cohort into one score. No reviewed accuracy, semantic improvement, or actual live baseline is claimed in this round.
