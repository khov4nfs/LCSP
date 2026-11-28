# LCSP-400 legal reasoning evaluation

**Round:** `LCSP_400_LEGAL_REASONING_RUBRIC_INTEGRATION_AND_DELIVERY_R2`
**Rubric:** `LCSP-400-LEGAL-REASONING-RUBRIC-V1`
**Candidate dataset:** `LCSP-400-LEGAL-REASONING-CANDIDATES-V1`

## Scope and method

This package defines a reproducible human-review method for separating the quality of legal reasoning from the quality of evidence. LegalBench is a methodological reference for task-specific legal evaluation, not a dataset or label source for this work ([LegalBench, NeurIPS 2023](https://proceedings.neurips.cc/paper_files/paper/2023/hash/89e44582fd28ddfea1ea4dcb0ebbf4b0-Abstract-Datasets_and_Benchmarks.html)).

The rubric is evaluation-only. It does not change Rule Set Preparation, Assessment Root, Researcher, production verdicts, or production statuses. Rule Set Preparation represents source-bound claims, including actors, conditions, qualifiers, and exceptions. Assessment Root decides scenario-level applicability and compliance and uses evidence references and human-resolution requests. Deterministic checks validate identity, provenance, and contract shape; they do not decide what the law means.

The canonical rubric and label inventory are in [`rubric.v1.json`](../../deepagents/evals/legal_reasoning/rubric.v1.json). The annotation contract is [`annotation.schema.v1.json`](../../deepagents/evals/legal_reasoning/annotation.schema.v1.json). The stage applicability table deliberately excludes scenario applicability, compliance, and repository evidence sufficiency from Rule Set Preparation.

### Domain mapping

- Assessment Root production applicability values `APPLICABLE` and `NOT_APPLICABLE` map directly to those evaluation labels. LCSP has no production `UNRESOLVED` applicability status. If a material fact is unknown, preserve the open `HumanResolutionRequest`; `UNRESOLVED` is an evaluation label only.
- Production compliance values `COMPLIANT` and `NON_COMPLIANT` map to `SUPPORTED_COMPLIANCE` and `SUPPORTED_NON_COMPLIANCE`. `INSUFFICIENT_EVIDENCE`, `UNRESOLVED`, and `NOT_APPLICABLE` are rubric labels. A null compliance result is mapped to `NOT_APPLICABLE` only when the explicit applicability value is `NOT_APPLICABLE`.
- Rule Set Preparation claim files provide the typed claim family and source-bound actor/semantic-frame fields. Conditions and exceptions use the existing claim types and relationships; they do not add contract values.
- Assessment Root `RuleDecision` references legal contexts and assessment evidence, while confirmed facts and open human resolutions retain their existing contract meanings. Since actor, conditions, exception handling, and substantive evidence quality are not complete categorical output fields, they require a separately recorded human judgment. The scorer does not inspect free text for keywords.
- Evidence sufficiency is reported on its own. It is not folded into the semantic dimensions or treated as an independent compliance verdict.

The full rubric entry for each of the seven dimensions contains its definition, allowed labels, production mapping, correct and incorrect examples, annotation rules, uncertainty/exclusion rules, metric eligibility, and stage applicability.

## Public source pin

The candidate cases use the English original Official Journal publication of Regulation (EU) 2016/679, pinned as `CELEX:32016R0679@OJ-L119-2016-05-04-EN`. The official source is the [EUR-Lex Official Journal PDF](https://eur-lex.europa.eu/eli/reg/2016/679/oj/eng/pdf). Exact article/paragraph references and concise provision notes are in [`source-pins.v1.json`](../../deepagents/evals/legal_reasoning/source-pins.v1.json); every case names one or more of those provision IDs and exact citations.

The source pin identifies the original publication. It does not assert that this file incorporates every later corrigendum, amendment, national implementation, or relevant authority. A qualified reviewer must verify the applicable law and source version before any candidate becomes reviewed gold. The provision notes are navigation aids, not legal advice or ground truth.

## Candidate dataset, evaluation targets, and annotation contract

[`candidate-cases.v1.jsonl`](../../deepagents/evals/legal_reasoning/candidate-cases.v1.jsonl) is the immutable, versioned candidate snapshot. It contains 30 synthetic scenarios with stable IDs, source pins, scenario facts, and counterfactual links. Each case declares an `evaluationTarget` so legal outcomes, fixed negative controls, and actual generated outputs cannot be scored as the same task:

- `ACTUAL_ASSESSMENT_OUTPUT`: 21 scenario-level legal outcome cases. Confirmed applicability and compliance labels may be compared with explicit Assessment Root categorical outputs. Actor, conditions, exceptions, evidence sufficiency, and unsupported-conclusion judgments require a separately recorded, output-bound human judgment.
- `RULE_SET_PREPARATION_OUTPUT`: 4 source-bound rule preparation cases. P14 has no Rule Set Preparation execution stage, so these cannot be evaluated end-to-end by the current harness.
- `FIXED_CLAIM_DIAGNOSTIC`: 5 predefined claim diagnostics. Their expected labels judge the supplied fixed claim only. They are excluded from generated-output scoring; an LCSP output that avoids the seeded bad claim must not be penalized for disagreeing with that claim.

All 30 annotations remain candidates. No genuine human reviewer identity, approval, adjudication, or reviewed gold label has been supplied. The four counterfactual pairs keep related cases together; no train/holdout partition is declared. The 15 pinned GDPR provision references are citation navigation anchors, not expert-verified gold legal conclusions.

R1 artifacts in [`reports/`](../../deepagents/evals/legal_reasoning/reports/) are retained as historical snapshots. Current review lifecycle reports are generated under `reports/r2/` from the canonical candidate snapshot and [`review-overlay.v1.json`](../../deepagents/evals/legal_reasoning/review-overlay.v1.json). The overlay pins the candidate dataset hash and each edited record hash; it carries reviewer decisions and label overrides without duplicating or mutating candidate facts. Empty overlay status is candidate-only. The synthetic scorer verification remains an arithmetic check, never measured Deep Agent accuracy.

From `deepagents/`, regenerate current lifecycle and synthetic verification reports offline with `uv run python -m evals.legal_reasoning.reporting --output-dir evals/legal_reasoning/reports/r2`. The command reads only versioned local fixtures and does not invoke a model. Reports calculate review counts from the merged overlay and never overwrite historical R1 artifacts.

The schema supports `CANDIDATE`, `INDEPENDENT_REVIEW`, `REVIEWED`, `ADJUDICATED`, `PROVISIONAL`, `UNCERTAIN`, and `EXCLUDED`. A reviewed annotation must have complete, consistent confirmed judgments for every scored expected dimension. An adjudicated annotation must resolve every dimension without reviewer consensus; unresolved disagreements and unconfirmed labels do not enter main metrics. Review IDs, references, and UTC timestamps are structurally validated, but repository metadata does not authenticate a reviewer. Synthetic and seeded references are rejected in the actual scoring path.

## Human-review handoff

Reviewers should open these files:

1. [`candidate-cases.v1.jsonl`](../../deepagents/evals/legal_reasoning/candidate-cases.v1.jsonl) — read the scenario and verify its stable ID and pinned case facts; do not edit this immutable snapshot.
2. [`rubric.v1.json`](../../deepagents/evals/legal_reasoning/rubric.v1.json) — definitions, labels, examples, stage applicability, and scoring rules.
3. [`source-pins.v1.json`](../../deepagents/evals/legal_reasoning/source-pins.v1.json) — pinned source version, citation map, and scope of source verification.
4. [`review-overlay.v1.json`](../../deepagents/evals/legal_reasoning/review-overlay.v1.json) — the single versioned review lifecycle record. Add a row under `caseReviews`; use the overlay schema and pin exact candidate-record SHA-256.

For each case, review the exact legal citation and source version, scenario facts, `evaluationTarget`, `claimUnderReview` where present, and each gold expectation relevant to that target. For actual generated-output targets use `expected` for legal outcomes. For fixed claims review `fixedOutputDiagnostic.expectedJudgments`; never transfer those labels into generated-output gold. Use `expectedOverrides` only for reviewed changes. Check that missing repository evidence is not treated as proof of a violation and that search hints and file names are not treated as verified facts.

Record each independent reviewer in the overlay row's `reviewers`: stable organization-controlled or pseudonymous ID, `reviewerType: HUMAN`, a reference to a genuine independent review record, UTC `reviewedAt`, decision, dimensions reviewed, per-dimension labels, and rationale. Do not put personal contact information in the repository. A non-empty reference is structural evidence only; a responsible human owner must confirm it identifies a real review record.

When a second reviewer is feasible, they review independently and record labels before comparison. Record every conflict under `reviewerDisagreements`. Until an independent adjudicator records an outcome and resolves every disputed or unconfirmed dimension, keep the case `INDEPENDENT_REVIEW` or `PROVISIONAL`. Use `UNCERTAIN` with `uncertaintyReason` where law or facts remain unclear, and `EXCLUDED` with `exclusionReason` where a case is unsuitable. A case-level status cannot replace dimension-level agreement or adjudication.

### Review observed LCSP output separately

Legal-gold review and output-quality review are separate activities. For an actual P14 output, create a `LCSP-400-OBSERVED-OUTPUT-REVIEWS-V1` file with `reviewSetKind: HUMAN_REVIEW`. Each row binds the candidate case, P14 case, evaluation stage, lifecycle stage, trial index, and complete `p14Binding` from the adapter. Record output judgments per dimension using the same reviewer, timestamp, disagreement, and adjudication fields. Review every repeated trial separately; do not select or average trials silently. The adapter rejects a mismatched run, case, lifecycle stage, trial, trace, output digest, source, rule, repository snapshot, model, or instruction digest. P14's `SEEDED_UNVERIFIED` binary reviews are diagnostics and never satisfy this contract.

### Calculate metrics

After authentic review records are supplied, run the integrated scorer from `deepagents/`:

```powershell
uv run python -m evals.cli legal-score `
  --manifest evals/reports/<run-id>/manifest.json `
  --trials evals/reports/<run-id>/trials.jsonl `
  --p14-cases evals/fixtures/benchmark/cases.json `
  --reviews evals/fixtures/benchmark/manual_reviews_p15.json `
  --dimension-reviews path/to/lcsp400-observed-output-reviews.v1.json `
  --review-overlay evals/legal_reasoning/review-overlay.v1.json `
  --output evals/reports/<run-id>/legal-reasoning.json
```

The checked-in overlay and observed-output reviews are empty. The P14 map contains no exact GDPR/source/rule/repository match, so the offline invocation validates artifacts and reports `NOT_SCORED`; it does not produce semantic metrics. The P14 adapter has no implicit trial aggregation: reports remain separate by lifecycle stage and trial.

## Scorer and reporting contract

The callable interface is `score_dataset(records, predictions, rubric, source_pins)` in [`scorer.py`](../../deepagents/evals/legal_reasoning/scorer.py). Input annotations are ordered JSONL records. Predictions contain:

```json
{
  "predictionVersion": "LCSP-400-NORMALIZED-PREDICTIONS-V1",
  "evaluationTarget": "ACTUAL_ASSESSMENT_OUTPUT",
  "sourceKind": "P14_SAVED_ARTIFACTS",
  "syntheticOnly": false,
  "runMetadata": {},
  "casePredictions": [
    {
      "caseId": "stable-case-id",
      "stage": "ASSESSMENT_ROOT",
      "evaluationTarget": "ACTUAL_ASSESSMENT_OUTPUT",
      "observationKind": "GENERATED_LCSP_OUTPUT",
      "dimensionPredictions": {
        "applicability": "APPLICABLE",
        "compliance": "NON_COMPLIANT"
      },
      "normalizationSource": "P14_SAVED_ARTIFACTS",
      "evaluationLabelPredictions": {
        "applicability": "APPLICABLE",
        "compliance": "SUPPORTED_NON_COMPLIANCE"
      },
      "humanJudgments": {},
      "p14Binding": {
        "runId": "...",
        "trialIndex": 0,
        "traceSha256": "...",
        "observedOutputSha256": "..."
      }
    }
  ]
}
```

For free-text reasoning, `humanJudgments` uses the dimension's categorical label plus `reviewStatus`, human reviewer identity/verification references, timestamp, disagreements, adjudication when applicable, and a `targetBinding` equal to the prediction's P14 binding. P14's normalized unresolved verdict is represented only in its separate evaluation-label field; production `RuleDecision` fields remain unchanged. It is not an LLM judge. No scorer path interprets legal prose or invents gold labels.

Reports contain separate stage and dimension metrics; semantic and evidence-quality groups expose their dimensions without an aggregate accuracy score. Confusion-matrix rows are gold classes and columns are predicted classes. Primary macro-F1 averages legitimate rubric labels with gold or legitimate prediction support; `__MISSING__` and `__UNKNOWN__` are visible error columns, never classes. Both remain in the denominator and increase false negatives for the gold class; legitimate wrong-class predictions also create false positives for their predicted class. Per-class precision/recall/F1 with zero denominator are `null`; a predicted-only class has zero F1. Aggregate FP/FN are multiclass rubric-label error totals, not the narrow legal concept of a false legal violation. Prediction coverage excludes missing labels; scoring coverage excludes missing and unknown labels. A zero reviewed denominator yields `NOT_SCORED` and null quality metrics, never 0% or 100%.

The report fingerprints canonical annotations, predictions, rubric, and source pins. For an actual run, `runMetadata` must retain the source snapshot, repository commit SHA, P14 evaluation manifest, candidate dataset/reviewed annotation version, rubric version, model configuration, prompt and skill versions, metrics, errors, token usage, and cost where available. The scorer's fixture digest is not a model baseline.

## P14 integration and reproducibility

### R3 PM review resolution

| Finding | Resolution |
|---|---|
| PM01 — SCRIPTED/LIVE trace contract | P14 writes a digest-bound `observedOutput` snapshot into its actual trace artifact. The adapter verifies trace bytes, nested run/case/trial/outcome identities, observed-output digest, and reviewer-required content. |
| PM02 — candidate/P14 cross-binding | V2 mapping requires exact shared case, source/provision, proposition/rule, scenario, repository, stage/lifecycle, trial target, and frozen split fingerprints. Independent pins do not establish correspondence. |
| PM03 — insufficient evidence | The rubric may record an output-bound human `INSUFFICIENT_EVIDENCE` judgment separately from the raw production verdict. It cannot overwrite an explicit categorical verdict. |
| PM04 — review target binding | P14 output reviews bind to saved execution artifacts; Preparation reviews bind to frozen output/source/claim metadata; fixed-claim diagnostics bind to the immutable candidate and claim digest. Bindings cannot cross targets. |
| PM05 — execution cohort accounting | Reports separate mapped, expected, executed, output-available, and scoring-eligible counts. Unexecuted targets are `NOT_EXECUTED`; executed outputs that are absent or invalid are visible missing-output errors; zero execution stays `NOT_SCORED`. |
| PM06 — frozen split | The versioned split sidecar groups related provisions and counterfactuals before deterministic assignment and binds the split digest into the P14 manifest. Its small cohort cannot support generalization claims. |
| PM07 — standalone provenance | Standalone arithmetic is always `STANDALONE_DIAGNOSTIC_UNVERIFIED`. Verified artifact reporting is only reachable through the P14 adapter after it validates saved manifest, trace, output, and outcome bytes. Artifact integrity does not authenticate a reviewer or establish legal quality. |

Regression coverage for these findings is in `tests/test_legal_reasoning_p14_integration.py` and `tests/test_legal_reasoning_r2_hardening.py`. The exact offline commands are below; the checked-in SCRIPTED report records artifact verification only, not reviewed legal metrics.

The thin adapter is [`p14_adapter.py`](../../deepagents/evals/legal_reasoning/p14_adapter.py), exposed through P14's existing `legal-score` command. It validates the saved manifest, `trials.jsonl`, exact trace bytes, benchmark case snapshot, outcome bindings, repository fixture trees, and the explicit case map with P14's existing loaders and validators. Each mapped trial remains separate. The report carries the run and manifest identities, source/split pins, repository commit, model route, prompt/skill fingerprints, lifecycle stage, trial identity, trace digest, and digest-bound observed output. It does not run a model or score free text.

### Targets and executable coverage

The 30 GDPR candidates remain unchanged and have **zero exact P14 mappings**. The five fixed-claim negative controls are diagnostics about supplied claims, not gold labels for generated outputs. The four Rule Set Preparation output cases cannot execute in P14's current Assessment Root runner. The remaining 21 GDPR Assessment Root candidates have no source, rule, scenario, and repository identity crosswalk to P14 fixtures. Their counts remain reported as unsupported rather than missing predictions.

[`p14-shared-cohort.v1.json`](../../deepagents/evals/legal_reasoning/p14-shared-cohort.v1.json) and [`p14-case-map.v2.json`](../../deepagents/evals/legal_reasoning/p14-case-map.v2.json) define a separate three-case SCRIPTED engineering slice reused from the exact checked-in P14 case objects (`CASE-01/INITIAL`, `CASE-17/INITIAL`, and `CASE-02/RESUME_FINAL`). These cases use synthetic pinned-law snippets and synthetic repository fixtures labelled `VN_FIXTURE_LABEL_ONLY`; they assert no Vietnamese legal rule and make no GDPR/Vietnam crosswalk. The merged LCSP-402 public source corpus was inspected, but its provisions and target rules do not match these P14 demo rules, so it is not used to invent a correspondence. No legal gold or legal-quality metric is attached to the engineering slice.

The P14 lifecycle values `INITIAL`, `WAITING_FOR_HUMAN`, `RESUME_FINAL`, and `FAULT_RECOVERY` remain lifecycle values, not LCSP evaluation stages. The map requires an exact P14 case, rule, legal source/provision bytes, target proposition, rule-set pin, scenario/HITL facts, repository fixture tree, stage, and split identity. Recomputed fingerprints reject stale or cross-bound rows; hashes prove identity only and do not decide legal equivalence.

P14 `SCRIPTED` and `LIVE` trace files now carry an `observedOutput` snapshot of the actual runtime assessment decisions, facts, evidence records and references, source/rule pins, HITL requests and resolution state, lifecycle history, run/case/trial identity, and outcome binding. The adapter verifies the exact saved trace bytes, observed-output digest, all identity bindings, and required review content. A missing snapshot is reported as `EXECUTED_MISSING_OUTPUT`; corrupted digests or bindings fail closed. `OFFLINE_FIXTURE`, `SCRIPTED`, and `LIVE` remain distinct classifications. A validated SCRIPTED artifact report is not a live model baseline or a human-reviewed semantic result.

### Frozen split

[`evaluation-splits.v1.json`](../../deepagents/evals/legal_reasoning/evaluation-splits.v1.json) pins split version, digest, groups, and memberships. Counterfactual pair IDs and related GDPR provision families are joined before assignment. The 30 GDPR candidates divide into 29 DEV and 1 HOLDOUT case; the three P14 engineering cases share one DEV group. The resulting 32 DEV / 1 HOLDOUT combined inventory is too small and too heterogeneous for generalization claims. P14 manifests bind to the split digest with `--evaluation-split-manifest`; the adapter recomputes group membership from the candidate and cohort snapshots and rejects drift.

### SCRIPTED integration reproduction

Run these PowerShell commands from `deepagents/`. They generate a derived case subset from exact checked-in P14 fixture objects, execute the real P14 runner in offline `SCRIPTED` mode, then validate and normalize its saved artifacts. No live or paid model route is used.

```powershell
$work = Join-Path $env:TEMP "lcsp400-pm-review-r3"
New-Item -ItemType Directory -Force $work | Out-Null
uv run python -m evals.legal_reasoning.p14_cohort `
  --source-cases evals/fixtures/benchmark/cases.json `
  --cohort evals/legal_reasoning/p14-shared-cohort.v1.json `
  --output "$work/p14-cases.json"
uv run python -m evals.cli run `
  --cases "$work/p14-cases.json" --mode SCRIPTED --split ALL --trials 2 --k 1 `
  --run-id lcsp400-pm-review-r3-scripted `
  --output-dir "$work/runs" `
  --evaluation-split-manifest evals/legal_reasoning/evaluation-splits.v1.json
uv run python -m evals.cli legal-score `
  --manifest "$work/runs/lcsp400-pm-review-r3-scripted/manifest.json" `
  --trials "$work/runs/lcsp400-pm-review-r3-scripted/trials.jsonl" `
  --p14-cases "$work/p14-cases.json" `
  --candidate-cases evals/legal_reasoning/candidate-cases.v1.jsonl `
  --case-map evals/legal_reasoning/p14-case-map.v2.json `
  --shared-cohort evals/legal_reasoning/p14-shared-cohort.v1.json `
  --evaluation-split-manifest evals/legal_reasoning/evaluation-splits.v1.json `
  --review-overlay evals/legal_reasoning/review-overlay.v1.json `
  --output "$work/legal-reasoning.json"
```

The reproducible checked-in report is [`reports/r3/p14-scripted-integration.v1.json`](../../deepagents/evals/legal_reasoning/reports/r3/p14-scripted-integration.v1.json). It records three mapped/executed cases, six mapped trials (two trials per exact mapped lifecycle target), output and trace digests, `NOT_SCORED`, zero reviewed-gold denominator, and `actualExecutionBaseline: NOT_RUN`. The complete SCRIPTED run artifacts used to produce it are retained next to the report under `reports/r3/p14-scripted-run/`. The legacy R2 zero-mapping report remains historical and is not the current integration evidence.

### Negative controls and scoring commands

The integration tests retain the zero-mapping case (including a test-only simulated review overlay), a one-case partial mapping, absent trial outcomes, present trials with missing output, repeated trials, and tampered trace/output/outcome digests. Run them with:

```powershell
uv run pytest tests/test_legal_reasoning_p14_integration.py -q
```

The deterministic scorer remains usable for standalone arithmetic and diagnostic checks. Such output is always marked `STANDALONE_DIAGNOSTIC_UNVERIFIED`, even if a caller supplies plausible hashes or a `P14_RUN_ARTIFACT` label. Only `legal-score` validates P14 artifact bytes; that validation still does not authenticate human reviewers or produce legal accuracy without reviewed gold. Reproduce the standalone fabricated-provenance negative control and the R1 synthetic scorer verification with:

```powershell
uv run pytest tests/test_legal_reasoning_r2_hardening.py::test_standalone_scoring_cannot_promote_fabricated_p14_provenance_to_verified -q
uv run python -m evals.legal_reasoning.reporting --output-dir "$env:TEMP/lcsp400-scorer-diagnostic"
```

The second command writes candidate lifecycle diagnostics and a clearly marked synthetic arithmetic verification. It invokes no model and must not be described as Deep Agent accuracy.

### Human review and future authorized baseline

Reviewers use [`candidate-cases.v1.jsonl`](../../deepagents/evals/legal_reasoning/candidate-cases.v1.jsonl) as the immutable legal-gold candidate snapshot and [`review-overlay.v1.json`](../../deepagents/evals/legal_reasoning/review-overlay.v1.json) as the single versioned review lifecycle record. They must review the legal source/citation and expected legal facts first, then separately review each observed LCSP output and create a dimension-review row bound to that exact manifest, run, case, trial, stage, lifecycle, target rule, trace bytes, and observed-output digest. A second reviewer records independent labels; an adjudicator must independently resolve each disputed dimension. Until genuine metadata exists, all candidate labels remain provisional for evaluation purposes. The structural validator cannot authenticate a person's identity; a responsible human owner must verify review references. P14 seeded reviews and test-only overlay states are never gold.

For future authorized execution, first supply compatible legally reviewed executable cases and matching candidate-to-P14 cross-bindings. Then use the exact run-to-report sequence below from `deepagents/`; `LIVE` requires a separately authorized model route. Use the same split manifest used during review and do not tune against HOLDOUT.

```powershell
$work = "evals/reports/lcsp400-authorized-baseline"
$runId = "replace-with-unique-approved-run-id"
$approvedModelRoute = "replace-with-authorized-model-route"
uv run python -m evals.cli run `
  --cases evals/fixtures/benchmark/cases.json --mode LIVE --split DEV `
  --trials 3 --k 1 3 --model-route $approvedModelRoute --allow-live `
  --run-id $runId --output-dir $work `
  --evaluation-split-manifest evals/legal_reasoning/evaluation-splits.v1.json
uv run python -m evals.cli legal-score `
  --manifest "$work/$runId/manifest.json" `
  --trials "$work/$runId/trials.jsonl" `
  --p14-cases evals/fixtures/benchmark/cases.json `
  --candidate-cases evals/legal_reasoning/candidate-cases.v1.jsonl `
  --case-map evals/legal_reasoning/p14-case-map.v2.json `
  --shared-cohort evals/legal_reasoning/p14-shared-cohort.v1.json `
  --evaluation-split-manifest evals/legal_reasoning/evaluation-splits.v1.json `
  --dimension-reviews path/to/genuine-output-reviews.v1.json `
  --review-overlay evals/legal_reasoning/review-overlay.v1.json `
  --output "$work/$runId/legal-reasoning.json"
```

This is a future command template only. No genuine human-reviewed annotation, qualified expert review, or authorized live execution artifact is available in R3. Therefore reviewed semantic metrics and the actual LCSP execution baseline remain `NOT_SCORED` / `NOT_RUN`. Reproducibility metadata must preserve the source snapshot, repository commit, P14 manifest and case digest, legal source/rule-set version, dataset and review-overlay digests, rubric/split versions and digests, model configuration, prompt/instruction/skill versions, every trial/output/trace identity, metrics, errors, budget, token usage, and cost where available. R1 GDPR gold cases and the separate synthetic P14 engineering cohort cannot be combined into one score.
