"""Offline cross-file retrieval ablation using the existing scanner and graph engine."""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import time
import tracemalloc
from concurrent.futures import ThreadPoolExecutor
from contextlib import ExitStack
from dataclasses import dataclass
from hashlib import sha256
from itertools import zip_longest
from pathlib import Path
from statistics import mean
from tempfile import TemporaryDirectory
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field
from tools.common.capabilities.platform.repository_scanner import (
    scan_repository_discovery,
)

from evals.benchmark_runner import (
    DEEPAGENTS_ROOT,
    _hash_repo_fixture_tree,
    load_benchmark_cases,
)
from evals.run_manifest import save_runtime_manifest, stable_hash
from evals.scorer import verify_evidence_integrity

_FIXTURES = DEEPAGENTS_ROOT / "evals/fixtures/benchmark"
_CONFIG_FILES = {"config.py", "requirements.txt", "pyproject.toml", "package.json"}
_K = (1, 3, 5, 10)
_MAX_CHARS = 12_000
_MAX_LINES = 24
_MAX_FILES = 100
_MAX_FILE_BYTES = 64_000
_MAX_SOURCE_BYTES = 512_000
_TIMEOUT_SECONDS = 60
_GRAPH_MEMORY_BUDGET_MB = 256
_RSS_SAMPLE_SECONDS = 0.01
_ENGINE_VERSION = "codebase-memory-mcp 0.11.0"
_NEGATIVE_CATEGORIES = {"BYPASS", "DEAD_CODE", "EXAMPLE_ONLY", "HARD_NEGATIVE", "TEST_ONLY"}


class GoldSpan(BaseModel):
    """One source assertion identified during annotation, including negative evidence."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    path: str
    start: int = Field(ge=1)
    end: int = Field(ge=1)
    anchor: str = Field(min_length=1)
    kind: Literal["SOURCE", "CALL", "INVOCATION", "BRANCH", "UNREACHABLE", "DORMANT_INVOCATION", "IMPORT"]


class RetrievalCase(BaseModel):
    """A fixed retrieval query and independently specified source requirements."""

    model_config = ConfigDict(extra="forbid", frozen=True)
    id: str
    symbols: tuple[str, ...] = Field(max_length=2)
    query: str = Field(min_length=1)
    category: str
    gold: tuple[GoldSpan, ...] = Field(min_length=1)
    pilotCaseId: str | None = None


@dataclass(frozen=True)
class Location:
    path: str
    start: int
    end: int


@dataclass(frozen=True)
class Graph:
    binary: Path
    cache: Path
    source: Path

    def _command(self, *args: str, timeout: int = _TIMEOUT_SECONDS) -> str:
        """Business purpose: Run pinned engine commands in a disposable fixture session.
        Business rules:
        - Bind cache and runtime sockets to scratch paths shared by startup, queries and shutdown.
        Execution flow:
        1. Execute the native binary without a shell. 2. Return its bounded-operation response.
        Failure cases:
        - A timed-out command is killed and reaped by subprocess; a nonzero exit surfaces diagnostics.
        Side effects:
        - The scoped daemon may write to scratch. This is a host benchmark for trusted fixtures.
        """
        env = {
            "PATH": os.defpath,
            "CBM_CACHE_DIR": str(self.cache),
            "CBM_RUNTIME_DIR": str(self.cache / "runtime"),
            "CBM_ALLOWED_ROOT": str(self.source),
            "CBM_MEM_BUDGET_MB": str(_GRAPH_MEMORY_BUDGET_MB),
        }
        result = subprocess.run(
            [str(self.binary), *args], cwd=self.cache, env=env,
            capture_output=True, text=True, timeout=timeout, check=False,
        )
        if result.returncode:
            raise RuntimeError(f"Graph {args[0]} exited {result.returncode}: {(result.stderr or result.stdout)[-500:]}")
        return result.stdout

    def call(
        self,
        tool: Literal["index_repository", "search_graph", "trace_path", "check_index_coverage"],
        **arguments: object,
    ) -> dict:
        """Business purpose: Query the existing graph engine over one verified fixture.
        Business rules:
        - Permit only index and read operations with an isolated cache and source scope.
        Execution flow:
        1. Run the trusted engine with explicit argv. 2. Decode its JSON response.
        Failure cases:
        - Timeout, an error reply or malformed JSON fails the run.
        Side effects:
        - The engine may write its scratch index outside the source tree.
        """
        payload = json.loads(self._command("cli", "--quiet", tool, json.dumps(arguments)))
        if payload.get("error"):
            raise ValueError(f"Graph {tool} failed: {payload['error']}")
        return payload


def _source_files(root: Path) -> dict[str, list[str]]:
    """Business purpose: Establish the original source inventory shared by all arms.
    Business rules:
    - A fixture consists only of regular, UTF-8 Python or named config files.
    Execution flow:
    1. Reject links and unsupported entries. 2. Read text by workspace-relative path.
    Failure cases:
    - Unreadable, noncanonical or unsupported source fails the run.
    Side effects:
    - Read-only inspection of fixture files.
    """
    files = {}
    total_bytes = 0
    for path in sorted(root.rglob("*")):
        # Exact inventory validation happens before the P14 tree hasher or native indexer reads it.
        if path.is_symlink():
            raise ValueError(f"Symlink in fixture: {path.name}")
        if path.is_dir():
            continue
        if not path.is_file() or (path.suffix != ".py" and path.name not in _CONFIG_FILES):
            raise ValueError(f"Unsupported fixture entry: {path.name}")
        size = path.stat().st_size
        total_bytes += size
        if len(files) >= _MAX_FILES or size > _MAX_FILE_BYTES or total_bytes > _MAX_SOURCE_BYTES:
            raise ValueError("Fixture exceeds the shared source inventory budget")
        files[path.relative_to(root).as_posix()] = path.read_text(encoding="utf-8").splitlines()
    if not files:
        raise ValueError("Fixture contains no source files")
    return files


def _sample_index_rss(log: Path) -> int | None:
    """Business purpose: Estimate native indexing memory from the isolated daemon and its workers.
    Business rules:
    - Use Linux process status only for the daemon announced by this run and its direct children.
    Execution flow:
    1. Resolve the isolated daemon PID. 2. Sum current resident bytes for it and its indexing workers.
    Failure cases:
    - Report missing samples on platforms without procfs or after a process exits.
    Side effects:
    - Reads transient local diagnostics without inspecting process environments or source contents.
    """
    try:
        start = re.search(r"msg=daemon\.start .*?\bpid=(\d+)", log.read_text())
        if not start:
            return None
        daemon = Path("/proc") / start[1]
        children = set()
        for task in (daemon / "task").iterdir():
            try:
                children.update((task / "children").read_text().split())
            except FileNotFoundError:
                continue
        rss = []
        for process in (daemon, *(Path("/proc") / pid for pid in children)):
            try:
                value = re.search(
                    r"^VmRSS:\s+(\d+) kB$", (process / "status").read_text(), re.MULTILINE,
                )
            except FileNotFoundError:
                continue
            if value:
                rss.append(int(value[1]) * 1024)
        return sum(rss) if rss else None
    except OSError:
        return None


def _graph_rows(payload: dict):
    """Business purpose: Normalize Codebase Memory result groups for source lookup.
    Business rules:
    - Preserve qualified names and source coordinates from flat BM25 rows and grouped regex or trace rows.
    Execution flow:
    1. Decode the declared columns. 2. Normalize flat BM25 rows to the grouped row shape.
    Failure cases:
    - Schema mismatches fail rather than silently shifting source coordinates.
    Side effects:
    - Pure iteration over in-memory JSON.
    """
    # Codebase Memory 0.11 uses flat rows for BM25 and groups for symbol/trace results.
    if "rows" in payload:
        for values in payload["rows"]:
            row = dict(zip(payload["cols"], values, strict=True))
            prefix, _, name = row["qn"].rpartition(".")
            yield {"qn_prefix": prefix, "file": row["file"]}, {**row, "name": name}
        return
    for group in payload["groups"]:
        for row in group["rows"]:
            yield group, dict(zip(payload["cols"], row, strict=True))


def _graph_locations(graph: Graph, project: str, symbols: tuple[str, ...], query: str) -> tuple[list[Location], dict]:
    """Business purpose: Retrieve candidate loci using graph symbols and caller/callee hops.
    Business rules:
    - Trace hops guide discovery only; related symbols require original source verification.
    Execution flow:
    1. Search supplied symbols or rank graph seeds from query text.
    2. Trace function anchors and resolve related nodes.
    Failure cases:
    - Missing nodes or bounded results reduce coverage.
    Side effects:
    - Query-only graph access in isolated scratch.
    """
    # A query-only case supplies text to the existing BM25 search tool without symbol or gold hints.
    selector = (
        {"name_pattern": "^(" + "|".join(re.escape(symbol) for symbol in symbols) + ")$"}
        if symbols else {"query": query}
    )
    search = graph.call("search_graph", project=project, limit=20 if symbols else 2, format="json", **selector)
    calls = 1
    seeds = list(_graph_rows(search))
    related = {}
    # Prioritize the nearest traced definitions with stable qualified-name tie breaking.
    for group, row in seeds:
        if row["label"] not in {"Function", "Method"}:
            continue
        name = f"{group['qn_prefix']}.{row['name']}"
        trace = graph.call("trace_path", project=project, function_name=name, direction="both", depth=3, format="json")
        calls += 1
        for direction in ("callees", "callers"):
            for parent, node in _graph_rows(trace.get(direction, {"groups": []})):
                qn = f"{parent['qn_prefix']}.{node['name']}"
                if qn.startswith(f"{project}."):
                    related[qn] = min(related.get(qn, node["hop"]), node["hop"])
    nodes = {}
    truncated = bool(search.get("has_more"))
    if related:
        qualified = "|".join(re.escape(qn) for qn in sorted(related))
        result = graph.call("search_graph", project=project, qn_pattern=f"^({qualified})$", limit=20, format="json")
        calls += 1
        truncated |= bool(result.get("has_more"))
        nodes = {f"{group['qn_prefix']}.{row['name']}": (group, row) for group, row in _graph_rows(result)}
    locations = []
    for group, row in [*seeds, *(nodes[qn] for qn in sorted(nodes, key=lambda qn: (related[qn], qn)))]:
        span = re.fullmatch(r"(\d+)-(\d+)", row["lines"])
        if span:
            locations.append(Location(group["file"], int(span[1]), int(span[2])))
    return locations, {"candidateCount": len(locations), "truncated": truncated, "seedCount": len(seeds), "toolCalls": calls}


def _scanner_locations(
    discovery: dict, symbols: tuple[str, ...], files: dict[str, list[str]], query: str,
) -> list[Location]:
    """Business purpose: Rank scanner candidate spans using the same query anchors.
    Business rules:
    - Preserve the scanner's own order for equal anchor matches.
    Execution flow:
    1. Prioritize matching symbols or lexical overlap with the query.
    2. Project scanner ranges with one context line.
    Failure cases:
    - Empty scanner results stay empty.
    Side effects:
    - Pure projection of scanner metadata.
    """
    # Keep scanner candidate generation constant and rank only the ranges it actually emitted.
    terms = {word for word in re.findall(r"[a-z]{3,}", query.lower()) if word not in {"the", "and", "with", "from", "its"}}
    ranked = []
    for row in discovery["sourceRanges"]:
        lines = files.get(row["path"], [])
        location = Location(row["path"], max(1, row["startLine"] - 1), min(len(lines), row["endLine"] + 1))
        if symbols:
            matches = int(row["symbol"] in symbols)
        else:
            text = " ".join([row["symbol"] or "", *lines[location.start - 1:location.end]])
            matches = len(terms.intersection(re.findall(r"[a-z]{3,}", text.lower())))
        ranked.append((matches, location))
    return [
        location for _, location in sorted(ranked, key=lambda item: -item[0])
    ]


def _evidence(root: Path, files: dict[str, list[str]], locations: list[Location], repo_id: str, pin: str) -> tuple[list[dict], int]:
    """Business purpose: Admit only bounded evidence read back from the pinned original files.
    Business rules:
    - Reject paths outside the shared inventory and invalid spans. Deduplicate covered spans.
    Execution flow:
    1. Limit ranges and budget. 2. Hash the source excerpt. 3. Verify with P14 integrity checks.
    Failure cases:
    - Invalid coordinates cannot become evidence; source integrity failure aborts the run.
    Side effects:
    - Read-only verification against staged source.
    """
    items: list[dict] = []
    used_chars = rejected = 0
    for location in locations:
        lines = files.get(location.path)
        if not lines or not 1 <= location.start <= location.end <= len(lines):
            rejected += 1
            continue
        end = min(location.end, location.start + _MAX_LINES - 1)
        if any(item["path"] == location.path and item["start_line"] <= location.start <= end <= item["end_line"] for item in items):
            continue
        excerpt = "\n".join(lines[location.start - 1:end])
        if used_chars + len(excerpt) > _MAX_CHARS:
            rejected += 1
            continue
        used_chars += len(excerpt)
        items.append({
            "evidenceType": "REPOSITORY_SOURCE", "path": location.path, "start_line": location.start,
            "end_line": end, "contentSha256": sha256(excerpt.encode()).hexdigest(),
            "repositoryId": repo_id, "commitSha": pin,
        })
        if len(items) == max(_K):
            break
    records = {str(index): item for index, item in enumerate(items)}
    if not verify_evidence_integrity(
        required_refs=records, observed_refs=records, observed_evidence_records=records,
        expected_repo_id=repo_id, expected_commit_sha=pin, repo_fixture_root=root,
    ):
        raise ValueError("P14 evidence integrity failed")
    return items, rejected


def _score(case: RetrievalCase, evidence: list[dict]) -> dict:
    """Business purpose: Score ranked source evidence against author-checked source coordinates.
    Business rules:
    - A hit must cover the full gold span; branch semantics and legal outcomes remain ungraded.
    Execution flow:
    1. Match each rank to covered spans. 2. Compute precision, recall and F1 at each cutoff.
    Failure cases:
    - Empty evidence yields zero scores; missing invocation spans remain explicit.
    Side effects:
    - Pure metric calculation.
    """
    # Counterevidence can itself contain real SDK code. Covering it never predicts reachability.
    negative = {
        idx for idx, gold in enumerate(case.gold)
        if case.category in _NEGATIVE_CATEGORIES and gold.kind != "INVOCATION"
    }
    metrics = {}
    for k in _K:
        hits = [
            {idx for idx, gold in enumerate(case.gold)
             if item["path"] == gold.path and item["start_line"] <= gold.start <= gold.end <= item["end_line"]}
            for item in evidence[:k]
        ]
        found = set().union(*hits)
        # Only a rank that adds a new gold span contributes to precision.
        seen: set[int] = set()
        useful = 0
        for matches in hits:
            useful += bool(matches - seen)
            seen.update(matches)
        precision = useful / k
        recall = len(found) / len(case.gold)
        missed = [gold for idx, gold in enumerate(case.gold) if idx not in found]
        metrics[str(k)] = {
            "precision": precision, "recall": recall,
            "f1": 2 * precision * recall / (precision + recall) if precision + recall else 0,
            "matchedPaths": sorted({case.gold[idx].path for idx in found}),
            "pathRecall": len({case.gold[idx].path for idx in found}) / len({gold.path for gold in case.gold}),
            "complete": not missed,
            "missedInvocations": sum(gold.kind == "INVOCATION" for gold in missed),
            "negativeEvidenceCovered": len(found & negative),
            "negativeEvidenceTotal": len(negative),
            "missedSpans": [gold.model_dump() for gold in missed],
        }
    return metrics


def _run_snapshot(source: Path, pin: str, repo_id: str, cases: list[RetrievalCase], binary: Path) -> tuple[dict, list[dict]]:
    """Business purpose: Compare the three retrieval arms over one admitted fixture snapshot.
    Business rules:
    - Verify the tree and gold before indexing. Every arm sees the same config and evidence limits.
    Execution flow:
    1. Check pins. 2. Stage regular source files. 3. Index and scan once. 4. Retrieve and score.
    Failure cases:
    - Pin mismatch, bad gold, or tool failure aborts before a successful report.
    Side effects:
    - Creates a disposable read-only source copy and an independent graph cache.
    """
    files = _source_files(source)
    if _hash_repo_fixture_tree(source) != pin:
        raise ValueError(f"Fixture tree pin mismatch: {repo_id}")
    for case in cases:
        for gold in case.gold:
            lines = files.get(gold.path, [])
            if not 1 <= gold.start <= gold.end <= len(lines) or gold.anchor not in "\n".join(lines[gold.start - 1:gold.end]):
                raise ValueError(f"Gold span no longer matches source: {case.id} {gold.path}")
    with TemporaryDirectory(prefix="lcsp-retrieval-") as scratch, ExitStack() as cleanup:
        work = Path(scratch)
        root, cache = work / "source", work / "cache"
        cache.mkdir()
        # Stage only the verified inventory and deny file writes; the native tool's cache is separate.
        for rel in files:
            dest = root / rel
            dest.parent.mkdir(parents=True, exist_ok=True)
            shutil.copyfile(source / rel, dest)
            dest.chmod(0o444)
        if _hash_repo_fixture_tree(root) != pin:
            raise ValueError(f"Staged tree pin mismatch: {repo_id}")
        tracemalloc.start()
        started = time.perf_counter()
        try:
            discovery = scan_repository_discovery(
                root, repository_id=repo_id, commit_sha=pin, max_scanned_files=_MAX_FILES,
                max_source_size_bytes=_MAX_FILE_BYTES, max_total_source_bytes=_MAX_SOURCE_BYTES, max_ranges=1000,
            )
            scanner_seconds = time.perf_counter() - started
            _, scanner_peak = tracemalloc.get_traced_memory()
        finally:
            tracemalloc.stop()

        graph = Graph(binary=binary, cache=cache, source=root)
        # A daemon scoped to this cache serves all arms. Stop it before removing scratch,
        # including when startup, indexing, or a later query raises or times out.
        (cache / "runtime").mkdir(mode=0o700)
        cleanup.callback(graph._command, "daemon", "stop")
        started = time.perf_counter()
        graph._command("daemon", "start")
        graph_start_seconds = time.perf_counter() - started
        started = time.perf_counter()
        # Sample the native worker, rather than the one-shot CLI process that only sends the request.
        graph_peak_rss = None
        with ThreadPoolExecutor(max_workers=1) as pool:
            job = pool.submit(
                graph.call, "index_repository", repo_path=str(root), name=repo_id, mode="full", persistence=False,
            )
            while not job.done():
                sample = _sample_index_rss(cache / "logs/cbm-daemon.log")
                if sample is not None:
                    graph_peak_rss = max(graph_peak_rss or 0, sample)
                time.sleep(_RSS_SAMPLE_SECONDS)
            index = job.result()
        graph_seconds = time.perf_counter() - started
        if index.get("status") != "indexed":
            raise ValueError(f"Graph indexing did not complete: {repo_id}")

        # Config is admitted first and identically in each arm, independent of either retriever.
        common = [Location(path, 1, len(lines)) for path, lines in files.items() if Path(path).name in _CONFIG_FILES]
        rows = []
        for case in cases:
            started = time.perf_counter()
            scanner = _scanner_locations(discovery, case.symbols, files, case.query)
            scanner_query_seconds = time.perf_counter() - started
            started = time.perf_counter()
            graph_locations, graph_coverage = _graph_locations(graph, repo_id, case.symbols, case.query)
            graph_query_seconds = time.perf_counter() - started
            # Round-robin bounds the hybrid context to the same budget as the individual arms.
            hybrid = [loc for pair in zip_longest(graph_locations, scanner) for loc in pair if loc is not None]
            arms = {}
            for arm, locations in {"A": scanner, "B": graph_locations, "C": hybrid}.items():
                evidence, rejected = _evidence(root, files, common + locations, repo_id, pin)
                arms[arm] = {"evidence": evidence, "rejectedCandidates": rejected, "metrics": _score(case, evidence)}
            rows.append({
                "caseId": case.id, "category": case.category, "pilotCaseId": case.pilotCaseId,
                "cohort": "symbolConditioned" if case.symbols else "queryOnly",
                "repositoryId": repo_id, "graphCoverage": graph_coverage,
                "scannerCandidates": len(scanner), "scannerQuerySeconds": scanner_query_seconds,
                "graphQuerySeconds": graph_query_seconds,
                "arms": arms,
            })

        if _hash_repo_fixture_tree(root) != pin or _hash_repo_fixture_tree(source) != pin:
            raise ValueError(f"Source changed during measurement: {repo_id}")
        snapshot = {
            "repositoryId": repo_id, "fixtureSha256": pin, "sourceFiles": len(files),
            "scannerSeconds": scanner_seconds, "scannerPythonPeakBytes": scanner_peak,
            "scannerCoverage": discovery["resourceLedger"], "scannerGaps": discovery["knownGaps"],
            "graphIndexSeconds": graph_seconds, "graphPeakSampledRssBytes": graph_peak_rss,
            "graphDaemonStartSeconds": graph_start_seconds,
            "graphIndex": {key: value for key, value in index.items() if key.endswith("_count") or key in {"nodes", "edges"}},
        }
        return snapshot, rows


def run_repository_retrieval(binary: Path, output_dir: Path) -> dict:
    """Business purpose: Produce an offline P13 repository retrieval manifest and comparative report.
    Business rules:
    - Only checked-in synthetic fixtures may enter the run. Reuse P14's pilot repository pins.
    Execution flow:
    1. Load fixture and pilot case metadata. 2. Compare retrieval arms. 3. Save receipts.
    Failure cases:
    - Missing prerequisites or incompatible engine stops evaluation without a success receipt.
    Side effects:
    - Writes only scratch graph state and the requested manifest and report.
    """
    binary = binary.resolve(strict=True)
    adapter_hash = sha256(Path(__file__).read_bytes()).hexdigest()
    version = subprocess.run([str(binary), "--version"], capture_output=True, text=True, check=True, timeout=10).stdout.strip()
    if version != _ENGINE_VERSION:
        raise ValueError(f"Expected {_ENGINE_VERSION}, received {version!r}")
    output_dir = output_dir.resolve()
    if output_dir.is_relative_to(_FIXTURES.resolve()):
        raise ValueError("Report output must stay outside fixture source")
    if (output_dir / "report.json").exists():
        raise FileExistsError("A benchmark report already exists in the output directory")
    fixture = json.loads((_FIXTURES / "cross_file_cases.json").read_text())
    cases = [RetrievalCase.model_validate(raw) for raw in fixture["cases"]]
    if len(cases) < 20 or len({case.id for case in cases}) != len(cases):
        raise ValueError("At least 20 uniquely identified cases are required")
    # Replay the cross-file questions without their exact-symbol hints or P14 symbol-name prompts.
    cross_file = [case for case in cases if not case.pilotCaseId]
    if any(re.search(rf"\b{re.escape(symbol)}\b", case.query, re.IGNORECASE)
           for case in cross_file for symbol in case.symbols):
        raise ValueError("Discovery query must not contain its exact seed symbol")
    cases.extend(case.model_copy(update={"id": f"query-{case.id}", "symbols": ()}) for case in cross_file)
    pilot_cases = {case.case_id: case for case in load_benchmark_cases(_FIXTURES / "cases.json", split="HOLDOUT")}
    pilot_manifest = json.loads((DEEPAGENTS_ROOT / "evals/reports/pilot-v1/manifest.json").read_text())
    # P14 seals a digest of the complete repository pin map. Reconstruct and validate it
    # before reusing any individual fixture tree, including the negative controls.
    if stable_hash({k: v for k, v in pilot_manifest.items() if k != "manifestSha256"}) != pilot_manifest["manifestSha256"]:
        raise ValueError("P14 pilot manifest digest mismatch")
    pilot_pins = {}
    for pilot in pilot_cases.values():
        repo = pilot.repo_pin
        if repo.repo_id not in pilot_pins:
            if repo.snapshot_kind != "SYNTHETIC_FIXTURE":
                raise ValueError("Host retrieval benchmark requires trusted synthetic fixtures")
            source = DEEPAGENTS_ROOT / repo.fixture_dir
            if source.is_symlink() or not source.resolve().is_relative_to((_FIXTURES / "repos").resolve()):
                raise ValueError("P14 source must be a checked-in fixture directory")
            _source_files(source)
            pilot_pins[repo.repo_id] = {
                "snapshotKind": repo.snapshot_kind, "commitSha": repo.commit_sha,
                "treeSha256": _hash_repo_fixture_tree(source),
            }
    if stable_hash(pilot_pins) != pilot_manifest["sourcePins"]["repoPinsSha256"]:
        raise ValueError("P14 repository pin map mismatch")
    groups = {}
    for case in cases:
        if case.pilotCaseId:
            pilot = pilot_cases[case.pilotCaseId]
            pin = pilot_pins[pilot.repo_pin.repo_id]["treeSha256"]
            source = DEEPAGENTS_ROOT / pilot.repo_pin.fixture_dir
        else:
            pin = fixture["fixtureSha256"]
            source = _FIXTURES / "repos" / fixture["fixture"]
        if source.is_symlink() or not source.resolve().is_relative_to((_FIXTURES / "repos").resolve()):
            raise ValueError("Benchmark source must be a checked-in fixture directory")
        groups.setdefault((source, pin), []).append(case)

    snapshots, rows = [], []
    for (source, pin), group_cases in groups.items():
        snapshot, results = _run_snapshot(source, pin, source.name, group_cases, binary)
        snapshots.append(snapshot)
        rows.extend(results)
    manifest = {
        "mode": "OFFLINE_RETRIEVAL", "locale": "en", "engine": version,
        "isolation": "HOST_TRUSTED_SYNTHETIC_FIXTURES_ONLY",
        "engineSha256": sha256(binary.read_bytes()).hexdigest(), "casesSha256": stable_hash(fixture),
        "pilotManifestSha256": pilot_manifest["manifestSha256"],
        "adapterSha256": adapter_hash,
        "scannerSha256": sha256(Path(scan_repository_discovery.__code__.co_filename).read_bytes()).hexdigest(),
        "retrieval": {
            "k": _K, "maxChars": _MAX_CHARS, "maxLinesPerSpan": _MAX_LINES,
            "indexMode": "full", "traceDepth": 3, "graphMemoryBudgetMb": _GRAPH_MEMORY_BUDGET_MB,
            "nativeRssSampleSeconds": _RSS_SAMPLE_SECONDS,
            "maxFiles": _MAX_FILES, "maxFileBytes": _MAX_FILE_BYTES, "maxSourceBytes": _MAX_SOURCE_BYTES,
        },
        "sourcePins": {row["repositoryId"]: row["fixtureSha256"] for row in snapshots},
        "cohorts": {mode: [row["caseId"] for row in rows if row["cohort"] == mode]
                    for mode in ("symbolConditioned", "queryOnly")},
        "model": None, "prompt": None, "skill": None,
    }
    manifest["manifestSha256"] = stable_hash(manifest)
    # Paired queries share an underlying topology, so never pool the two cohorts.
    summary = {}
    for cohort in manifest["cohorts"]:
        summary[cohort] = {}
        for arm in ("A", "B", "C"):
            summary[cohort][arm] = {}
            for k in _K:
                metrics = [row["arms"][arm]["metrics"][str(k)] for row in rows if row["cohort"] == cohort]
                summary[cohort][arm][str(k)] = {
                    **{field: mean(item[field] for item in metrics) for field in ("precision", "recall", "f1", "pathRecall")},
                    "completeCases": sum(item["complete"] for item in metrics),
                    **{field: sum(item[field] for item in metrics) for field in
                       ("missedInvocations", "negativeEvidenceCovered", "negativeEvidenceTotal")},
                }
    report = {
        "manifestSha256": manifest["manifestSha256"], "caseCount": len(rows),
        "snapshots": snapshots, "cases": rows, "summary": summary,
        "providerCalls": 0, "tokens": 0, "providerCost": 0, "downstreamAccuracy": None,
        "downstreamInvocationFalsePositiveRate": None,
    }
    save_runtime_manifest(output_dir / "manifest.json", manifest)
    # Exclusive creation preserves the first run's measurements and blocks output symlinks.
    with (output_dir / "report.json").open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2)
        output.write("\n")
    return report
