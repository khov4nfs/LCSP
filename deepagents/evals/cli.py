"""Unified CLI for LCSP evaluation benchmark: manifest, run, and score.

Usage (from deepagents/):
  uv run python -m evals.cli manifest --cases evals/fixtures/benchmark/cases.json --output evals/reports/manifest.json
  uv run python -m evals.cli run --cases evals/fixtures/benchmark/cases.json --mode OFFLINE_FIXTURE --trials 5 --k 1 3 5 --output-dir evals/reports
  uv run python -m evals.cli score --trials evals/reports/<run_id>/trials.jsonl --manifest evals/reports/<run_id>/manifest.json --output-dir evals/reports/<run_id>
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Sequence

from evals.benchmark_runner import (
    build_benchmark_manifest,
    load_benchmark_cases,
    load_manual_reviews,
    run_benchmark,
)
from evals.benchmark_schema import RunConfig, TrialOutcome
from evals.run_manifest import save_runtime_manifest
from evals.scorer import build_benchmark_report, export_report_csv, export_report_json


def main(argv: Sequence[str] | None = None) -> int:
    """Business purpose: Provide one-command CLI for manifest reproduction, benchmark runs, and pass^k scoring.

    Business rules:
    - Offline CI commands never invoke paid models; LIVE mode requires --allow-live.
    - Persists immutable manifests, all trial outcomes (including failures), and JSON/CSV reports.

    Execution flow:
    1. Parse subcommand (manifest | run | score).
    2. Load validated cases/reviews or trials.jsonl.
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
    p_run.add_argument("--allow-live", action="store_true")
    p_run.add_argument("--output-dir", type=Path, required=True)

    p_score = sub.add_parser("score", help="Score an existing trials.jsonl file into JSON and CSV")
    p_score.add_argument("--trials", type=Path, required=True)
    p_score.add_argument("--manifest", type=Path, required=True)
    p_score.add_argument("--reviews", type=Path, default=None)
    p_score.add_argument("--k", type=int, nargs="+", default=[1, 3])
    p_score.add_argument("--output-dir", type=Path, required=True)

    args = parser.parse_args(argv)

    if args.command == "manifest":
        config = RunConfig(
            mode=args.mode,
            split=args.split,
            trials_per_case=args.trials,
            k_values=tuple(args.k),
            locale=args.locale,
        )
        cases = load_benchmark_cases(args.cases, split=args.split)
        manifest = build_benchmark_manifest(run_id=args.run_id, cases=cases, config=config)
        save_runtime_manifest(args.output, manifest)
        print(json.dumps({"runId": args.run_id, "manifestSha256": manifest["manifestSha256"], "output": str(args.output)}))
        return 0

    if args.command == "run":
        config = RunConfig(
            mode=args.mode,
            split=args.split,
            trials_per_case=args.trials,
            k_values=tuple(args.k),
            locale=args.locale,
            allow_live=args.allow_live,
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
        reviews = load_manual_reviews(args.reviews)
        report = build_benchmark_report(
            run_id=manifest["runId"],
            manifest_sha256=manifest["manifestSha256"],
            mode=outcomes[0].mode if outcomes else "OFFLINE_FIXTURE",
            outcomes=outcomes,
            k_values=tuple(args.k),
            manual_reviews=reviews,
        )
        export_report_json(args.output_dir / "report.json", report)
        export_report_csv(args.output_dir / "report.csv", outcomes, tuple(args.k))
        print(json.dumps({"runId": report["runId"], "semanticOverall": report["semanticReliability"]["overall"]["passPowK"]}))
        return 0

    return 1


if __name__ == "__main__":
    raise SystemExit(main())
