"""Unified CLI for LCSP evaluation benchmark: manifest, run, and score.

Usage (from deepagents/):
  uv run python -m evals.cli manifest --cases evals/fixtures/benchmark/cases.json --output evals/reports/manifest.json
  uv run python -m evals.cli run --cases evals/fixtures/benchmark/cases.json --mode OFFLINE_FIXTURE --trials 5 --k 1 3 5 --output-dir evals/reports
  uv run python -m evals.cli score --trials evals/reports/<run_id>/trials.jsonl --manifest evals/reports/<run_id>/manifest.json --output-dir evals/reports/<run_id>
  uv run python -m evals.cli legal-score --manifest evals/reports/<run_id>/manifest.json --trials evals/reports/<run_id>/trials.jsonl --output evals/reports/<run_id>/legal-reasoning.json
"""
from __future__ import annotations

import argparse
import json
from collections.abc import Sequence
from pathlib import Path

from evals.benchmark_runner import (
    build_benchmark_manifest,
    load_benchmark_cases,
    load_manual_reviews,
    run_benchmark,
)
from evals.benchmark_schema import RunConfig, TrialOutcome
from evals.run_manifest import save_runtime_manifest
from evals.scorer import (
    build_benchmark_report,
    build_trial_metadata_map,
    export_report_csv,
    export_report_json,
    validate_run_artifacts_for_scoring,
)


def main(argv: Sequence[str] | None = None) -> int:
    """Business purpose: Provide one-command CLI for manifest reproduction, benchmark runs, and pass^k scoring.

    Business rules:
    - Offline CI commands never invoke paid models; LIVE mode requires --allow-live and --model-route.
    - Persists immutable manifests, all trial outcomes (including failures), and JSON/CSV reports.

    Execution flow:
    1. Parse the benchmark, offline policy baseline, repository-retrieval, or legal-score subcommand.
    2. Load validated cases/reviews or trials.jsonl and verify integrity.
    3. Execute requested action and print bounded JSON summary.

    Failure cases:
    - Invalid arguments, missing files, or unauthorized LIVE mode return nonzero.

    Side effects:
    - Writes manifest/trials/reports to caller-specified paths.
    """
    parser = argparse.ArgumentParser(description="LCSP Evaluation Benchmark CLI")
    sub = parser.add_subparsers(dest="command", required=True)

    p_manifest = sub.add_parser("manifest", help="Generate and save reproducible run manifest")
    p_manifest.add_argument("--cases", type=Path, required=True)
    p_manifest.add_argument("--run-id", default="reproducible-manifest")
    p_manifest.add_argument("--mode", choices=["OFFLINE_FIXTURE", "SCRIPTED", "LIVE"], default="OFFLINE_FIXTURE")
    p_manifest.add_argument("--split", choices=["DEV", "HOLDOUT", "ALL"], default="ALL")
    p_manifest.add_argument("--trials", type=int, default=3)
    p_manifest.add_argument("--k", type=int, nargs="+", default=[1, 3])
    p_manifest.add_argument("--locale", choices=["en", "vi"], default="en")
    p_manifest.add_argument("--model-route", default="offline-scripted")
    p_manifest.add_argument("--git-commit-sha", default=None)
    p_manifest.add_argument("--evaluation-split-manifest", type=Path, default=None)
    p_manifest.add_argument("--output", type=Path, required=True)

    p_run = sub.add_parser("run", help="Run benchmark trials and export pass^k JSON/CSV reports")
    p_run.add_argument("--cases", type=Path, required=True)
    p_run.add_argument("--reviews", type=Path, default=None)
    p_run.add_argument("--run-id", default=None)
    p_run.add_argument("--mode", choices=["OFFLINE_FIXTURE", "SCRIPTED", "LIVE"], default="OFFLINE_FIXTURE")
    p_run.add_argument("--split", choices=["DEV", "HOLDOUT", "ALL"], default="ALL")
    p_run.add_argument("--trials", type=int, default=3)
    p_run.add_argument("--k", type=int, nargs="+", default=[1, 3])
    p_run.add_argument("--locale", choices=["en", "vi"], default="en")
    p_run.add_argument("--model-route", default="offline-scripted")
    p_run.add_argument("--git-commit-sha", default=None)
    p_run.add_argument("--evaluation-split-manifest", type=Path, default=None)
    p_run.add_argument("--allow-live", action="store_true")
    p_run.add_argument("--output-dir", type=Path, required=True)

    p_score = sub.add_parser("score", help="Score an existing trials.jsonl file into JSON and CSV")
    p_score.add_argument("--trials", type=Path, required=True)
    p_score.add_argument("--manifest", type=Path, required=True)
    p_score.add_argument("--reviews", type=Path, default=None)
    p_score.add_argument("--k", type=int, nargs="+", default=[1, 3])
    p_score.add_argument("--output-dir", type=Path, required=True)

    p_b1 = sub.add_parser("rag-b1", help="Run single-pass RAG baseline (B1) integrated with P14")
    p_b1.add_argument("--cases", type=Path, required=True)
    p_b1.add_argument("--run-id", default=None)
    p_b1.add_argument("--mode", choices=["OFFLINE_FIXTURE", "SCRIPTED", "LIVE"], default="SCRIPTED")
    p_b1.add_argument("--split", choices=["DEV", "HOLDOUT", "ALL"], default="ALL")
    p_b1.add_argument("--trials", type=int, default=3)
    p_b1.add_argument("--k", type=int, nargs="+", default=[1, 3])
    p_b1.add_argument("--locale", choices=["en", "vi"], default="en")
    p_b1.add_argument("--model-route", default="offline-scripted")
    p_b1.add_argument("--allow-live", action="store_true")
    p_b1.add_argument("--output-dir", type=Path, required=True)

    # Keep the offline repository ablation on the existing evaluation entry point.
    p_repo = sub.add_parser(
        "repository-retrieval",
        help="Compare scanner, graph and hybrid retrieval on pinned fixtures",
    )
    p_repo.add_argument("--graph-binary", type=Path, required=True)
    p_repo.add_argument("--output-dir", type=Path, required=True)

    eval_root = Path(__file__).resolve().parent
    p_legal_score = sub.add_parser(
        "legal-score",
        help="Validate saved P14 artifacts and run the LCSP-400 legal rubric scorer",
    )
    p_legal_score.add_argument("--manifest", type=Path, required=True)
    p_legal_score.add_argument("--trials", type=Path, required=True)
    p_legal_score.add_argument(
        "--p14-cases", type=Path, default=eval_root / "fixtures" / "benchmark" / "cases.json"
    )
    p_legal_score.add_argument(
        "--candidate-cases", type=Path, default=eval_root / "legal_reasoning" / "candidate-cases.v1.jsonl"
    )
    p_legal_score.add_argument(
        "--case-map", type=Path, default=eval_root / "legal_reasoning" / "p14-case-map.v2.json"
    )
    p_legal_score.add_argument(
        "--shared-cohort", type=Path, default=eval_root / "legal_reasoning" / "p14-shared-cohort.v1.json"
    )
    p_legal_score.add_argument(
        "--evaluation-split-manifest", type=Path, default=eval_root / "legal_reasoning" / "evaluation-splits.v1.json"
    )
    p_legal_score.add_argument(
        "--reviews", type=Path, default=None,
        help="Optional P14 binary review artifact; never treated as LCSP-400 dimension gold",
    )
    p_legal_score.add_argument(
        "--dimension-reviews", type=Path, default=None,
        help="Optional separately authored LCSP-400 human judgments bound to P14 output traces",
    )
    p_legal_score.add_argument(
        "--review-overlay", type=Path,
        default=eval_root / "legal_reasoning" / "review-overlay.v1.json",
        help="Versioned human review state and legal-gold overrides pinned to candidate snapshot",
    )
    p_legal_score.add_argument("--output", type=Path, required=True)

    # The documentary baseline runs locally and has no provider route or live mode.
    p_policy = sub.add_parser("policy-baseline", help="Evaluate Vietnamese documentary policies and smoke-test P14 offline")
    p_policy.add_argument("--output-dir", type=Path, required=True)

    args = parser.parse_args(argv)

    if args.command == "policy-baseline":
        from evals.policy_baseline import run_policy_baseline

        report = run_policy_baseline(args.output_dir)
        print(json.dumps({key: report[key] for key in ("comparisonMode", "rootManifestSha256", "metrics")}))
        return 0

    if args.command == "repository-retrieval":
        from evals.repository_retrieval import run_repository_retrieval

        report = run_repository_retrieval(args.graph_binary, args.output_dir)
        print(json.dumps({key: report[key] for key in ("manifestSha256", "caseCount", "summary")}))
        return 0

    if args.command == "legal-score":
        from evals.legal_reasoning.p14_adapter import integrate_p14_artifacts

        report = integrate_p14_artifacts(
            manifest_path=args.manifest,
            trials_path=args.trials,
            p14_cases_path=args.p14_cases,
            candidate_cases_path=args.candidate_cases,
            case_mapping_path=args.case_map,
            shared_cohort_path=args.shared_cohort,
            split_manifest_path=args.evaluation_split_manifest,
            reviews_path=args.reviews,
            dimension_reviews_path=args.dimension_reviews,
            review_overlay_path=args.review_overlay,
        )
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(
            json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
            encoding="utf-8",
        )
        print(
            json.dumps(
                {
                    "runId": report["runMetadata"]["runId"],
                    "artifactValidationStatus": report["artifactValidationStatus"],
                    "scoringStatus": report["scoringStatus"],
                    "mappedCaseCount": report["caseMapping"]["mappedCaseCount"],
                    "output": str(args.output),
                }
            )
        )
        return 0

    if args.command == "manifest":
        from evals.legal_reasoning.splits import load_split_manifest

        config = RunConfig(
            mode=args.mode,
            split=args.split,
            trials_per_case=args.trials,
            k_values=tuple(args.k),
            locale=args.locale,
            model_route=args.model_route,
            git_commit_sha=args.git_commit_sha,
            case_split_manifest_sha256=(
                load_split_manifest(args.evaluation_split_manifest)["splitDigest"]
                if args.evaluation_split_manifest
                else None
            ),
        )
        cases = load_benchmark_cases(args.cases, split=args.split)
        manifest = build_benchmark_manifest(run_id=args.run_id, cases=cases, config=config)
        save_runtime_manifest(args.output, manifest)
        print(json.dumps({"runId": args.run_id, "manifestSha256": manifest["manifestSha256"], "output": str(args.output)}))
        return 0

    if args.command == "run":
        from evals.legal_reasoning.splits import load_split_manifest

        config = RunConfig(
            mode=args.mode,
            split=args.split,
            trials_per_case=args.trials,
            k_values=tuple(args.k),
            locale=args.locale,
            model_route=args.model_route,
            allow_live=args.allow_live,
            git_commit_sha=args.git_commit_sha,
            case_split_manifest_sha256=(
                load_split_manifest(args.evaluation_split_manifest)["splitDigest"]
                if args.evaluation_split_manifest
                else None
            ),
        )
        cases = load_benchmark_cases(args.cases, split=args.split)
        reviews = load_manual_reviews(args.reviews)
        report = run_benchmark(
            cases=cases,
            config=config,
            output_dir=args.output_dir,
            run_id=args.run_id,
            manual_reviews=reviews,
        )
        print(json.dumps({
            "runId": report["runId"],
            "manifestSha256": report["manifestSha256"],
            "semanticOverall": report["semanticReliability"]["overall"]["passPowK"],
            "faultRecovery": report["faultInjectionRecovery"]["passPowK"],
        }))
        return 0

    if args.command == "score":
        manifest = json.loads(args.manifest.read_text(encoding="utf-8"))
        outcomes = [
            TrialOutcome.model_validate_json(line)
            for line in args.trials.read_text(encoding="utf-8").splitlines()
            if line.strip()
        ]
        validate_run_artifacts_for_scoring(manifest, outcomes, base_dir=args.trials.parent)
        reviews = load_manual_reviews(args.reviews)
        trial_metadata_by_key = build_trial_metadata_map(manifest, outcomes)
        report = build_benchmark_report(
            run_id=manifest["runId"],
            manifest_sha256=manifest["manifestSha256"],
            mode=outcomes[0].mode if outcomes else "OFFLINE_FIXTURE",
            outcomes=outcomes,
            k_values=tuple(args.k),
            manual_reviews=reviews,
            trial_metadata_by_key=trial_metadata_by_key,
        )
        export_report_json(args.output_dir / "report.json", report)
        export_report_csv(args.output_dir / "report.csv", outcomes, tuple(args.k))
        print(json.dumps({"runId": report["runId"], "semanticOverall": report["semanticReliability"]["overall"]["passPowK"]}))
        return 0

    if args.command == "rag-b1":
        from evals.rag_baseline import run_b1_baseline

        config = RunConfig(
            mode=args.mode,
            split=args.split,
            trials_per_case=args.trials,
            k_values=tuple(args.k),
            locale=args.locale,
            model_route=args.model_route,
            allow_live=args.allow_live,
        )
        cases = load_benchmark_cases(args.cases, split=args.split, include_fault_injection=False)
        report = run_b1_baseline(
            cases=cases,
            config=config,
            output_dir=args.output_dir,
            run_id=args.run_id,
        )
        print(json.dumps({
            "runId": report["runId"],
            "manifestSha256": report["manifestSha256"],
            "semanticOverall": report["semanticReliability"]["overall"]["passPowK"],
        }))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
