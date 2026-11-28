# LCSP-400 legal reasoning evaluation

**Round:** `LCSP_400_LEGAL_REASONING_RUBRIC_CORE_IMPLEMENTATION_R1`
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

## Candidate dataset and annotation contract

[`candidate-cases.v1.jsonl`](../../deepagents/evals/legal_reasoning/candidate-cases.v1.jsonl) is the single canonical review file. It contains 30 distinct synthetic scenarios, each with a stable ID, stage, primary dimension, case description, source version/citations, scenario facts, candidate expectations, rationale, source/evidence references, review metadata, and optional reciprocal counterfactual-pair metadata.

All 30 annotations are `CANDIDATE`. There are no reviewer identities, approvals, adjudications, or human-reviewed labels in the actual dataset. Candidate labels and rationales were authored for review and must not be described as verified legal ground truth. The four counterfactual pairs keep related cases together; no train/holdout partition is declared in R1.

R1 generated two separate reports under [`reports/`](../../deepagents/evals/legal_reasoning/reports/): [`candidate-diagnostics.v1.json`](../../deepagents/evals/legal_reasoning/reports/candidate-diagnostics.v1.json) describes the 30 candidate records, 15 pinned citation references, stage and dimension coverage, and the zero-review denominator; [`scorer-verification.v1.json`](../../deepagents/evals/legal_reasoning/reports/scorer-verification.v1.json) scores only the isolated synthetic fixture. The synthetic report is a scorer arithmetic check, not measured Deep Agent accuracy. Human-reviewed semantic evaluation is `NOT_STARTED`; the actual LCSP execution baseline is `NOT_RUN`.

From the `deepagents` directory, regenerate both reports offline with `uv run python -m evals.legal_reasoning.reporting`. The command reads only the versioned candidate dataset, rubric, source pins, and isolated synthetic fixture; it does not invoke a model.

The schema supports these review states: `CANDIDATE`, `INDEPENDENT_REVIEW`, `REVIEWED`, `ADJUDICATED`, `PROVISIONAL`, `UNCERTAIN`, and `EXCLUDED`. Only `REVIEWED` and an adjudication with outcome `CONFIRM` or `REVISE` qualify for main metrics. The validator requires reviewer type, identity reference, timestamp, decisions, and dimension-level judgments. A reviewed row with unresolved disagreements is rejected. An adjudicated row retains the original disagreement and the adjudicator's resolved labels and evidence reference. Excluded, uncertain, provisional, and candidate rows remain visible in coverage counts but do not enter quality denominators.

## Human-review handoff

Reviewers should open these files:

1. [`candidate-cases.v1.jsonl`](../../deepagents/evals/legal_reasoning/candidate-cases.v1.jsonl) — edit this canonical file; do not create a second manually maintained gold copy.
2. [`rubric.v1.json`](../../deepagents/evals/legal_reasoning/rubric.v1.json) — definitions, labels, examples, stage applicability, and scoring rules.
3. [`source-pins.v1.json`](../../deepagents/evals/legal_reasoning/source-pins.v1.json) — pinned source version, citation map, and scope of source verification.

For each case, verify or revise the exact citation and source version; the scenario facts; `claimUnderReview` where present; every relevant `expected` label and detail; `annotationRationale`; and whether the case is uncertain or excluded. Check that missing repository evidence is not treated as proof of a violation and that search hints and file names are not treated as verified facts. Remove `confidence: CANDIDATE` from every expected dimension that has been confirmed; leave uncertain labels marked uncertain and keep those cases out of reviewed metrics.

Record each independent reviewer in `reviewers` with a stable reviewer ID, `reviewerType: HUMAN`, a checkable `identityVerificationRef` to an independent review record, UTC `reviewedAt`, decision, dimensions reviewed, per-dimension labels, and rationale. Use an organization-controlled identifier or pseudonymous ID; do not put personal contact information in the repository. A reviewer verification reference must point to a real record, not a synthetic fixture URI.

When a second reviewer is feasible, they should review the provision and facts independently and record their own per-dimension labels before comparing. If labels differ, add each proposed label under `reviewerDisagreements` and keep the case `INDEPENDENT_REVIEW` or `PROVISIONAL`; do not score it. A separate qualified adjudicator records their verified identity, evidence reference, outcome, rationale, and resolved labels. Mark `ADJUDICATED` only for a confirmed or revised resolution. Use `UNCERTAIN` with `uncertaintyReason` when legal or factual uncertainty remains, or `EXCLUDED` with `exclusionReason` when a case is unsuitable.

After genuine review metadata and labels are saved, run the scorer from the `deepagents` directory:

```powershell
uv run python -m evals.legal_reasoning.scorer `
  --dataset evals/legal_reasoning/candidate-cases.v1.jsonl `
  --predictions path/to/p14-normalized-predictions.v1.json `
  --output artifacts/legal-reasoning/scorer-report.json
```

The prediction file must use `LCSP-400-NORMALIZED-PREDICTIONS-V1`, one unique `caseId` and matching `stage`, explicit `dimensionPredictions` for production categorical values, and separately reviewed `humanJudgments` for dimensions requiring semantic interpretation. A missing prediction remains a missing denominator case. An unknown label is retained as `__UNKNOWN__` and counted. The scorer validates gold and provenance before calculating metrics.

No qualified legal reviewer has reviewed these candidates as of R1. Run the scorer after genuine review to obtain measured reviewed-case metrics; the report in this round is only synthetic scorer verification.

## Scorer and reporting contract

The callable interface is `score_dataset(records, predictions, rubric, source_pins)` in [`scorer.py`](../../deepagents/evals/legal_reasoning/scorer.py). Input annotations are ordered JSONL records. Predictions contain:

```json
{
  "predictionVersion": "LCSP-400-NORMALIZED-PREDICTIONS-V1",
  "sourceKind": "P14_RUN_ARTIFACT",
  "syntheticOnly": false,
  "runMetadata": {},
  "casePredictions": [
    {
      "caseId": "stable-case-id",
      "stage": "ASSESSMENT_ROOT",
      "dimensionPredictions": {"applicability": "APPLICABLE", "compliance": "NON_COMPLIANT"},
      "humanJudgments": {}
    }
  ]
}
```

For free-text reasoning, `humanJudgments` uses the dimension's categorical label plus `reviewStatus`, human reviewer identity/verification references, timestamp, disagreements, and adjudication when applicable. It is not an LLM judge. No scorer path interprets legal prose or invents gold labels.

Reports contain separate stage and dimension metrics; semantic and evidence-quality groups expose their dimensions without an aggregate accuracy score. Each scored dimension includes a gold-row/prediction-column confusion matrix, macro-F1, class precision/recall/F1/support, false positives/negatives, eligible denominator, prediction and review coverage, missing predictions, and invalid/unknown predictions. Prediction coverage counts any supplied label; scoring coverage counts valid labels, so an unknown label does not appear as missing but lowers scoring coverage. Labels with either gold or prediction support enter macro-F1; labels absent on both sides are omitted. Any zero denominator yields `null`; an empty reviewed dataset reports `NOT_SCORED`.

The report fingerprints canonical annotations, predictions, rubric, and source pins. For an actual run, `runMetadata` must retain the source snapshot, repository commit SHA, P14 evaluation manifest, candidate dataset/reviewed annotation version, rubric version, model configuration, prompt and skill versions, metrics, errors, token usage, and cost where available. The scorer's fixture digest is not a model baseline.

## P14 integration boundary and R2 work

LCSP-399 became available during this round in `origin/develop` commit `bfa6a4d503a4b66186075da9902620be638da487`. Its stable entrypoint is `evals.cli`; `run` produces `manifest.json`, `trials.jsonl`, and `report.json`/`report.csv`, while `score` validates and reports those saved artifacts. P14's canonical contracts are in [`benchmark_schema.py`](../../deepagents/evals/benchmark_schema.py), [`benchmark_runner.py`](../../deepagents/evals/benchmark_runner.py), and [`scorer.py`](../../deepagents/evals/scorer.py). This R1 package does not duplicate execution orchestration, model invocation, trace collection, manifest management, or budget tracking.

Direct scoring integration is deferred because the P14 pilot contract does not line up with this candidate dataset. P14 uses its own `CASE-*` identifiers and lifecycle stages (`INITIAL`, `WAITING_FOR_HUMAN`, `RESUME_FINAL`, `FAULT_RECOVERY`); this dataset uses independent stable IDs and evaluation stages (`ASSESSMENT_ROOT`, `RULE_SET_PREPARATION`). P14 `ManualReviewRecord` currently records a combined verdict plus binary evidence and authority judgments, not the separate actor, legal-condition, exception, evidence-sufficiency, and unsupported-conclusion judgments required here. Its checked-in `manual_reviews_p15.json` records are `SEEDED_UNVERIFIED`, and the pilot report has zero `expertVerified` reviews. They are not reviewed gold and cannot make the R1 candidate cases eligible for metrics. The pilot report is offline fixture output, not an actual LCSP execution baseline.

R2 should use P14's existing manifest and trace-bound review records, map P14 run identity, case ID, stage, trial, trace hash, model route, instruction-bundle digest, and rule-set version into the normalized prediction provenance, and add only a thin adapter at that boundary. It must preserve the current dimension split: map explicit verdict values only where a unique applicability/compliance mapping is justified, and obtain separately recorded, verified human judgments for the remaining semantic dimensions and evidence quality. First resolve how these 30 candidate cases are represented by P14 (or author matching P14 cases) and obtain genuine independent/adjudicated review. Then run an authorized actual LCSP baseline with the documented reproducibility metadata, add regression/CI wiring to the P14 mechanism, and perform final regression and PR/task delivery. Do not use unreviewed agent text as gold, treat model agreement as adjudication, or score candidate labels.
