"""Run the offline, pinned Assessment Discovery scanner evaluation corpus.

This evaluator executes no repository code, network request, language model, or
external benchmark recorder. It compares the manifest-oriented RepositoryProfile
baseline with LCSP_DISCOVERY_V1 over identical source-controlled fixtures.
"""

from __future__ import annotations

import argparse
from hashlib import sha256
import json
from pathlib import Path
import platform
import tempfile
import time
import tracemalloc
from types import SimpleNamespace
from typing import Any, Callable

from tools.common.capabilities.platform.repository_scanner import (
    ensure_repository_discovery,
    scan_repository_discovery,
    scan_repository_workspace,
)

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CORPUS = ROOT / "evaluation/discovery_scanner_corpus.json"
INVOCATION_SIGNALS = {"AI_SDK_CALL", "RAW_AI_HTTP_CALL", "AI_WRAPPER"}
AI_FRAMEWORK_CATEGORIES = {"AI_PROVIDER_SDK", "AI_ORCHESTRATION", "ML_FRAMEWORK"}


def _measure(call: Callable[[], dict[str, Any]]) -> tuple[dict[str, Any], float, int]:
    """Business purpose: Measure one deterministic scanner execution without model or provider instrumentation.

    Business rules:
    - Wall time and Python allocation peak are diagnostic measurements, never legal or source-coverage evidence.
    - Each call gets an isolated tracemalloc window.

    Execution flow:
    1. Start allocation tracing and a monotonic timer.
    2. Execute the scanner and capture elapsed milliseconds and peak bytes.
    3. Stop tracing and return the scanner output with measurements.

    Failure cases:
    - Scanner exceptions propagate and abort the evaluation rather than producing partial success metrics.

    Side effects:
    - Temporarily enables process-local allocation tracing; performs no external writes.
    """
    tracemalloc.start()
    started = time.perf_counter_ns()
    try:
        result = call()
        elapsed_ms = (time.perf_counter_ns() - started) / 1_000_000
        _, peak_bytes = tracemalloc.get_traced_memory()
        return result, elapsed_ms, peak_bytes
    finally:
        tracemalloc.stop()


def _binary_metrics(expected: set[str], predicted: set[str]) -> dict[str, Any]:
    """Business purpose: Compute transparent set-based recall/precision without invented confidence scores.

    Business rules:
    - Empty expected/predicted sets score precision and recall as 1.0 only when both are empty.
    - False positives and false negatives retain exact corpus identities for review.

    Execution flow:
    1. Derive true positives, false positives and false negatives.
    2. Calculate precision, recall and false-negative rate using explicit denominators.

    Failure cases:
    - None; input sets are already bounded by the checked-in corpus.

    Side effects:
    - Pure calculation with no persistence or external calls.
    """
    true_positive = expected & predicted
    false_positive = predicted - expected
    false_negative = expected - predicted
    precision = (
        len(true_positive) / len(predicted)
        if predicted
        else 1.0 if not expected else 0.0
    )
    recall = (
        len(true_positive) / len(expected)
        if expected
        else 1.0 if not predicted else 0.0
    )
    false_negative_rate = len(false_negative) / len(expected) if expected else 0.0
    return {
        "truePositiveCount": len(true_positive),
        "falsePositiveCount": len(false_positive),
        "falseNegativeCount": len(false_negative),
        "precision": precision,
        "recall": recall,
        "falseNegativeRate": false_negative_rate,
        "falsePositives": sorted(false_positive),
        "falseNegatives": sorted(false_negative),
    }


def _write_case(root: Path, files: dict[str, str]) -> None:
    """Business purpose: Materialize one source-controlled synthetic repository for offline scanning.

    Business rules:
    - Every path must remain inside the disposable case directory.
    - Fixture bytes are written exactly as checked in and are never executed.

    Execution flow:
    1. Validate each POSIX-relative path.
    2. Create parent directories and write UTF-8 fixture text.

    Failure cases:
    - Absolute/traversal paths raise before any out-of-root write.

    Side effects:
    - Writes only inside the caller-owned temporary evaluation directory.
    """
    for raw_path, content in files.items():
        relative = Path(raw_path)
        if relative.is_absolute() or ".." in relative.parts:
            raise ValueError(f"Unsafe corpus path: {raw_path}")
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(content, encoding="utf-8")


class _MemoryBackend:
    """Minimal repository-discovery cache backend used only by the offline evaluator."""

    def __init__(self) -> None:
        self.storage: dict[str, str] = {}
        self.write_count = 0

    def read(self, path: str) -> str | SimpleNamespace:
        """Business purpose: Return an exact cached discovery artifact for evaluator replay checks.

        Business rules:
        - Cached content is addressed only by the scanner-provided path.
        - A missing artifact is represented as the same NOT_FOUND shape used by repository backends.

        Execution flow:
        1. Look up the requested path in process-local storage.
        2. Return the stored JSON text or a typed missing-result stand-in.

        Failure cases:
        - Missing paths return NOT_FOUND and let the production cache helper decide whether to rescan.

        Side effects:
        - Read-only access to process-local evaluator state.
        """
        return self.storage.get(path, SimpleNamespace(error="NOT_FOUND"))

    def write(self, path: str, content: str) -> SimpleNamespace:
        """Business purpose: Record scanner cache writes so exact-pin reuse can be verified.

        Business rules:
        - The latest content for one cache path replaces the prior process-local value.
        - Every write increments the observable counter, including same-content rewrites.

        Execution flow:
        1. Store the supplied JSON text at the requested cache path.
        2. Increment the write counter and return a success-shaped result.

        Failure cases:
        - None; storage is an in-memory dictionary bounded by the evaluation run.

        Side effects:
        - Mutates process-local evaluator cache state and its write counter only.
        """
        self.storage[path] = content
        self.write_count += 1
        return SimpleNamespace(error=None)


def _cache_correctness(root: Path) -> dict[str, bool]:
    """Business purpose: Verify exact-pin reuse and invalidation across commit, rename/delete and graph changes.

    Business rules:
    - Same commit/scope/scanner/graph pins must reuse the exact artifact.
    - Source mutations are evaluated only with a new immutable commit pin.
    - A graph/index version change must refresh connectivity-derived discovery.

    Execution flow:
    1. Scan and replay one exact pin set.
    2. Modify source under a new commit and verify digest/cache refresh.
    3. Rename/delete the invocation under another commit and verify paths refresh.
    4. Change graph identity and verify cache invalidation.

    Failure cases:
    - Scanner/cache errors propagate; false booleans remain visible in the evaluation result.

    Side effects:
    - Mutates only the disposable cache fixture and its in-memory backend.
    """
    backend = _MemoryBackend()
    source = root / "src/model.py"
    source.parent.mkdir(parents=True, exist_ok=True)
    source.write_text("def run(prompt):\n    return client.responses.create(input=prompt)\n", encoding="utf-8")
    first = ensure_repository_discovery(
        backend,
        repository_id="cache-eval",
        commit_sha="1" * 40,
        workspace_path=root,
        graph_index_version="graph-a",
    )
    writes_after_first = backend.write_count
    replay = ensure_repository_discovery(
        backend,
        repository_id="cache-eval",
        commit_sha="1" * 40,
        workspace_path=root,
        graph_index_version="graph-a",
    )
    writes_after_replay = backend.write_count
    source.write_text("def run(prompt):\n    return client.responses.create(input=prompt, temperature=0)\n", encoding="utf-8")
    modified = ensure_repository_discovery(
        backend,
        repository_id="cache-eval",
        commit_sha="2" * 40,
        workspace_path=root,
        graph_index_version="graph-a",
    )
    renamed = root / "workers/model_job.py"
    renamed.parent.mkdir(parents=True, exist_ok=True)
    renamed.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")
    source.unlink()
    moved = ensure_repository_discovery(
        backend,
        repository_id="cache-eval",
        commit_sha="3" * 40,
        workspace_path=root,
        graph_index_version="graph-a",
    )
    graph_changed = ensure_repository_discovery(
        backend,
        repository_id="cache-eval",
        commit_sha="3" * 40,
        workspace_path=root,
        graph_index_version="graph-b",
    )
    moved_paths = {row["path"] for row in moved["sourceRanges"]}
    return {
        "exactPinReplay": replay == first,
        "exactPinAvoidedRewrite": writes_after_replay == writes_after_first,
        "modifiedCommitRefresh": modified["cacheIdentity"] != first["cacheIdentity"],
        "renamedDeletedPathRefresh": "src/model.py" not in moved_paths and "workers/model_job.py" in moved_paths,
        "graphVersionRefresh": graph_changed["cacheIdentity"] != moved["cacheIdentity"],
    }


def run_evaluation(corpus_path: Path = DEFAULT_CORPUS) -> dict[str, Any]:
    """Business purpose: Produce reproducible before/after scanner measurements over identical pinned fixtures.

    Business rules:
    - Baseline and discovery scan the same fixture bytes, repository ID and commit.
    - Gold labels are checked-in expectations; missing coverage remains a false negative, never evidence of absence.
    - Model tokens, question quality and legal accuracy are explicitly unmeasured in this deterministic scanner-only run.

    Execution flow:
    1. Load and validate the corpus, materialize each case and execute both scanners.
    2. Aggregate repository/use-case, invocation-range, rule-control, classification, latency, memory and context-size metrics.
    3. Run exact-pin cache correctness checks and return a JSON-serializable receipt.

    Failure cases:
    - Invalid corpus shape, duplicate IDs, unsafe paths or scanner failures abort without a partial success receipt.

    Side effects:
    - Creates disposable temporary repositories; performs no network/model calls or external recorder writes.
    """
    corpus_bytes = corpus_path.read_bytes()
    corpus = json.loads(corpus_bytes)
    if corpus.get("schemaVersion") != "LCSP_DISCOVERY_EVAL_V1" or not isinstance(corpus.get("cases"), list):
        raise ValueError("Unsupported discovery evaluation corpus")
    case_ids = [case.get("id") for case in corpus["cases"]]
    if any(not isinstance(case_id, str) or not case_id for case_id in case_ids) or len(set(case_ids)) != len(case_ids):
        raise ValueError("Discovery evaluation case IDs must be unique non-empty strings")

    gold_cases: set[str] = set()
    baseline_cases: set[str] = set()
    discovery_cases: set[str] = set()
    gold_invocations: set[str] = set()
    discovery_invocations: set[str] = set()
    gold_rule_paths: set[str] = set()
    discovery_rule_paths: set[str] = set()
    classification_total = 0
    classification_correct = 0
    baseline_latency = discovery_latency = 0.0
    baseline_peak = discovery_peak = 0
    baseline_source_files: set[str] = set()
    discovery_source_files: set[str] = set()
    discovery_range_count = 0
    per_case: list[dict[str, Any]] = []

    with tempfile.TemporaryDirectory(prefix="lcsp-discovery-eval-") as temp:
        evaluation_root = Path(temp)
        for index, case in enumerate(corpus["cases"]):
            case_id = case["id"]
            case_root = evaluation_root / f"case-{index:02d}"
            _write_case(case_root, case["files"])
            repository_id = f"eval-{case_id}"
            commit = sha256(case_id.encode("utf-8")).hexdigest()[:40]
            baseline, elapsed, peak = _measure(
                lambda root=case_root, rid=repository_id, sha=commit: scan_repository_workspace(
                    root, repository_id=rid, commit_sha=sha
                )
            )
            discovery, new_elapsed, new_peak = _measure(
                lambda root=case_root, rid=repository_id, sha=commit: scan_repository_discovery(
                    root,
                    repository_id=rid,
                    commit_sha=sha,
                    graph_index_version="eval-graph-v1",
                )
            )
            baseline_latency += elapsed
            discovery_latency += new_elapsed
            baseline_peak = max(baseline_peak, peak)
            discovery_peak = max(discovery_peak, new_peak)
            expected_ai = case["expectedAiUse"] is True
            baseline_ai = any(
                framework["category"] in AI_FRAMEWORK_CATEGORIES
                for framework in baseline["frameworks"]
            )
            discovery_ai = bool(discovery["aiUseCases"])
            if expected_ai:
                gold_cases.add(case_id)
            if baseline_ai:
                baseline_cases.add(case_id)
            if discovery_ai:
                discovery_cases.add(case_id)
            expected_invocations = {
                f"{case_id}:{path}" for path in case["expectedInvocationPaths"]
            }
            predicted_invocations = {
                f"{case_id}:{row['path']}"
                for row in discovery["sourceRanges"]
                if row["signalType"] in INVOCATION_SIGNALS
            }
            expected_rule = {
                f"{case_id}:{path}" for path in case["expectedRuleRelevantPaths"]
            }
            predicted_rule = {
                f"{case_id}:{row['path']}"
                for row in discovery["sourceRanges"]
                if row["signalType"] == "CONTROL"
            }
            gold_invocations.update(expected_invocations)
            discovery_invocations.update(predicted_invocations)
            gold_rule_paths.update(expected_rule)
            discovery_rule_paths.update(predicted_rule)
            classifications = {
                row["path"]: row["sourceClassification"]
                for row in discovery["sourceRanges"]
            }
            for path, expected_classification in case["expectedClassifications"].items():
                classification_total += 1
                if classifications.get(path) == expected_classification:
                    classification_correct += 1
            baseline_source_files.update(
                f"{case_id}:{fact['evidence']['path']}"
                for fact in baseline["candidateFacts"]
            )
            discovery_source_files.update(
                f"{case_id}:{row['path']}" for row in discovery["sourceRanges"]
            )
            discovery_range_count += len(discovery["sourceRanges"])
            per_case.append(
                {
                    "id": case_id,
                    "expectedAiUse": expected_ai,
                    "baselineAiUse": baseline_ai,
                    "discoveryAiUse": discovery_ai,
                    "invocationFalseNegatives": sorted(expected_invocations - predicted_invocations),
                    "invocationFalsePositives": sorted(predicted_invocations - expected_invocations),
                    "knownGapCount": len(discovery["knownGaps"]),
                }
            )
        cache = _cache_correctness(evaluation_root / "cache-case")

    return {
        "schemaVersion": "LCSP_DISCOVERY_EVAL_RESULT_V1",
        "corpus": {
            "path": corpus_path.relative_to(ROOT).as_posix(),
            "sha256": "sha256:" + sha256(corpus_bytes).hexdigest(),
            "caseCount": len(corpus["cases"]),
        },
        "environment": {"python": platform.python_version(), "platform": platform.platform()},
        "baseline": {
            "kind": "REPOSITORY_PROFILE_MANIFEST_SIGNALS",
            "aiUseCase": _binary_metrics(gold_cases, baseline_cases),
            "sourceRange": _binary_metrics(gold_invocations, set()),
            "sourceFilesProjected": len(baseline_source_files),
            "modelCalls": 0,
            "tokens": 0,
            "latencyMs": baseline_latency,
            "peakPythonBytes": baseline_peak,
        },
        "discovery": {
            "kind": "LCSP_DISCOVERY_V1",
            "aiUseCase": _binary_metrics(gold_cases, discovery_cases),
            "sourceRange": _binary_metrics(gold_invocations, discovery_invocations),
            "ruleRelevantSource": _binary_metrics(gold_rule_paths, discovery_rule_paths),
            "classificationAccuracy": (
                classification_correct / classification_total if classification_total else 1.0
            ),
            "classificationCorrect": classification_correct,
            "classificationTotal": classification_total,
            "sourceFilesProjected": len(discovery_source_files),
            "rangeCount": discovery_range_count,
            "modelCalls": 0,
            "tokens": 0,
            "latencyMs": discovery_latency,
            "peakPythonBytes": discovery_peak,
        },
        "cacheCorrectness": cache,
        "unmeasured": {
            "llmInputOutputTokens": "No model is invoked by this deterministic scanner evaluation.",
            "questionQuality": "Requires a separately pinned Interview execution corpus.",
            "evidenceReuseRate": "Requires durable assessment executions.",
            "legalAccuracy": "Requires approved legal gold decisions and human review.",
        },
        "cases": per_case,
    }


def main() -> int:
    """Business purpose: Expose the offline scanner evaluation as a reproducible local/CI command.

    Business rules:
    - Default output is stdout; an explicit output path may receive the executed result.
    - The command never contacts a provider or external recorder.

    Execution flow:
    1. Parse corpus/output paths and run the evaluator.
    2. Serialize the actual execution receipt and optionally write it.

    Failure cases:
    - Invalid inputs or evaluation failures return a non-zero process exit through the uncaught exception.

    Side effects:
    - May write one caller-selected JSON result; otherwise writes stdout only.
    """
    parser = argparse.ArgumentParser()
    parser.add_argument("--corpus", type=Path, default=DEFAULT_CORPUS)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    result = run_evaluation(args.corpus.resolve())
    rendered = json.dumps(result, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(rendered, encoding="utf-8")
    print(rendered, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
