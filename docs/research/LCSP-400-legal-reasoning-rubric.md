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

The thin adapter is [`p14_adapter.py`](../../deepagents/evals/legal_reasoning/p14_adapter.py), exposed as the P14 CLI subcommand `legal-score`. It consumes P14's actual saved manifest, `trials.jsonl`, trace files, benchmark cases, and review records through P14's existing loaders and validators. Its output retains run/manifest identity, evaluation mode, P14 dataset digest, repository commit, model route, prompt and instruction/skill fingerprints, usage, source pins, lifecycle stage, trial identity, output digest, and trace digest. Each repeated trial is reported separately; no best-of or averaging policy is applied.

The explicit case map is [`p14-case-map.v1.json`](../../deepagents/evals/legal_reasoning/p14-case-map.v1.json). Its pins cover the immutable candidate snapshot, legal source pins, and exact P14 corpus snapshot. It currently maps zero of the 30 candidates: 21 Assessment Root cases have no exact source/rule/repository crosswalk, 4 Rule Set Preparation cases cannot execute in this Assessment Root harness, and 5 fixed-claim diagnostics are not generated-output cases. These are unsupported/excluded from current end-to-end execution metrics, not merely unmapped by case ID. Current P14 stages (`INITIAL`, `WAITING_FOR_HUMAN`, `RESUME_FINAL`, `FAULT_RECOVERY`) remain lifecycle stages and are never treated as LCSP evaluation stages.

Reproduce the saved offline P14 integration verification from `deepagents/` without model calls. Generate the run using the current P14 case snapshot, then score those saved artifacts:

```powershell
uv run python -m evals.cli run `
  --cases evals/fixtures/benchmark/cases.json `
  --mode OFFLINE_FIXTURE --split ALL --trials 1 --k 1 `
  --run-id lcsp400-p14-offline-v1 `
  --output-dir evals/reports
uv run python -m evals.cli legal-score `
  --manifest evals/reports/lcsp400-p14-offline-v1/manifest.json `
  --trials evals/reports/lcsp400-p14-offline-v1/trials.jsonl `
  --p14-cases evals/fixtures/benchmark/cases.json `
  --review-overlay evals/legal_reasoning/review-overlay.v1.json `
  --output evals/legal_reasoning/reports/p14-integration-verification.v1.json
```

The current command validates P14's artifact inventory and trace hashes, reports zero exact mappings, zero LCSP-400 output judgments, `NOT_SCORED`, and `actualExecutionBaseline: NOT_RUN`. The checked-in P14 binary review fixture is bound to the archived `pilot-v1` run; it is not passed to a different run, and its seeded-unverified records never become LCSP-400 gold. The adapter may map explicit categorical Assessment Root verdicts only after a future case mapping is exact; P14 `UNRESOLVED` stays distinct from missing and invalid values in `evaluationLabelPredictions`, while production fields remain as recorded. Actor, conditions, exceptions, and evidence quality always need separately recorded judgments bound to the observed output. Each dimension judgment's `targetBinding` must exactly equal the review row's `p14Binding`.

Before an authorized future baseline, add and review compatible P14 cases and exact mappings, verify legal-gold annotations in the overlay, and obtain approval for live execution. From `deepagents/`, the P14 run command is:

```powershell
$approvedModelRoute = "replace-with-approved-model-route"
uv run python -m evals.cli run `
  --cases evals/fixtures/benchmark/cases.json `
  --mode LIVE --split DEV --trials 3 --k 1 3 `
  --model-route $approvedModelRoute --allow-live `
  --output-dir evals/reports/lcsp400-authorized-baseline
```

Use the `runId` printed by P14 to score and normalize the saved artifacts:

```powershell
$runId = "paste-run-id-printed-by-p14"
uv run python -m evals.cli score `
  --manifest "evals/reports/lcsp400-authorized-baseline/$runId/manifest.json" `
  --trials "evals/reports/lcsp400-authorized-baseline/$runId/trials.jsonl" `
  --reviews evals/fixtures/benchmark/manual_reviews_p15.json `
  --output-dir "evals/reports/lcsp400-authorized-baseline/$runId"
uv run python -m evals.cli legal-score `
  --manifest "evals/reports/lcsp400-authorized-baseline/$runId/manifest.json" `
  --trials "evals/reports/lcsp400-authorized-baseline/$runId/trials.jsonl" `
  --p14-cases evals/fixtures/benchmark/cases.json `
  --reviews evals/fixtures/benchmark/manual_reviews_p15.json `
  --dimension-reviews path/to/lcsp400-observed-output-reviews.v1.json `
  --review-overlay evals/legal_reasoning/review-overlay.v1.json `
  --output "evals/reports/lcsp400-authorized-baseline/$runId/legal-reasoning.json"
```

These are reproducibility templates only; no live or paid model evaluation has been authorized or run in R2. The current benchmark has no executable exact mapping, so a future run must not be reported as an LCSP-400 baseline until the map is updated and validation succeeds.

Reproducibility records must preserve source snapshot, repository commit, P14 manifest, dataset and overlay hashes, rubric version, model configuration, prompt/skill versions, metrics, errors, budget, token usage, and cost where available. P14 `run`/`score` remains responsible for orchestration, traces, budget tracking, and generic reporting; LCSP-400 adds only the mapping, human-review validation, and legal rubric scoring layer.
