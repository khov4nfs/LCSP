# P13 cross-file repository evidence retrieval

Baseline checkout: `develop` at `8e3497fc22f4178119b6021a5f5db802dc723e6c`. The experiment adapts cross-file retrieval evaluation to LCSP source citations. RepoBench evaluates retrieval and code completion, and RepoGraph evaluates repository navigation for software engineering. [RepoBench (ICLR 2024)](https://proceedings.iclr.cc/paper_files/paper/2024/hash/d191ba4c8923ed8fd8935b7c98658b5f-Abstract-Conference.html) · [RepoGraph (ICLR 2025)](https://arxiv.org/abs/2410.14684)

## Design

Twenty fixed, English-language source queries cover nine pinned synthetic snapshots. Twelve queries use the new seven-file Python fixture. They cover direct and indirect invocation, checked-in configuration, conditional bypass, dead code, dormant SDK use, demos, a test double, and local-only operations. Eight negative controls reuse the P14 holdout repository pins. The case author inspected each expected call site, definition, branch and config line. The runner checks the gold anchors against the original files. A separate reviewer has yet to sign off the new annotations.

- **A** uses production Repository Scanner discovery ranges. It prioritizes matching symbols and adds one line of context around each range.
- **B** uses the sandbox-pinned Codebase Memory 0.11.0. It searches the same fixed symbol anchors and traces up to three graph hops.
- **C** interleaves B and A, graph first, under the individual-arm limits.
- Every arm receives identical config and dependency excerpts at the first ranks when those files exist. Each arm admits up to 10 excerpts, 24 lines per excerpt and 12,000 characters per query. The staged source inventory is identical across arms and the native graph cache is outside the snapshot.
- Paths and full spans must match the gold to receive credit. Precision@k counts ranks that add at least one distinct gold span, divided by k. Recall@k counts distinct covered gold spans. Path recall requires at least one full gold span on a path. F1 macro-averages the per-case harmonic mean. Invocation misses are counted per case and can refer to the same physical SDK line in different queries.

The evidence output contains source coordinates and hashes. The runner reads the original staged text and verifies the evidence with P14's integrity scorer, the same scorer used by the P17 adapter. Pinned originals and staged trees are checked for drift. The tools parse the fixture and never import or execute it.

## Results

| Arm | k | Precision | Span recall | F1 | Path recall | Complete | Missed invocation spans |
| --- | --: | --: | --: | --: | --: | --: | --: |
| A | 1 | 30.0% | 12.8% | 0.169 | 12.9% | 1/20 | 7 |
| A | 3 | 25.0% | 37.6% | 0.278 | 40.4% | 4/20 | 1 |
| A | 5 | 16.0% | 38.8% | 0.212 | 41.7% | 4/20 | 0 |
| A | 10 | 8.0% | 38.8% | 0.127 | 41.7% | 4/20 | 0 |
| B | 1 | 60.0% | 42.8% | 0.469 | 42.9% | 7/20 | 7 |
| B | 3 | 41.7% | 73.0% | 0.494 | 78.3% | 9/20 | 6 |
| B | 5 | 35.0% | 91.1% | 0.476 | 95.0% | 16/20 | 2 |
| B | 10 | 18.5% | 93.8% | 0.296 | 95.0% | 18/20 | 0 |
| C | 1 | 60.0% | 42.8% | 0.469 | 42.9% | 7/20 | 7 |
| C | 3 | 43.3% | 78.0% | 0.519 | 83.3% | 10/20 | 5 |
| C | 5 | 35.0% | 93.3% | 0.478 | 94.6% | 16/20 | 1 |
| C | 10 | 19.0% | 98.8% | 0.305 | 100.0% | 19/20 | 0 |

### Coverage and trade-offs

- At k=5, graph-only completes 9/12 cross-file queries and 7/8 P14 controls. Hybrid completes 8/12 cross-file queries and 8/8 P14 controls. Aggregate improvement can hide a regression on the cross-file subset.
- At k=5, hybrid recovers the SDK span that graph-only ranks below the cutoff on the conditional cloud and service queries. In the indirect query, interleaving pushes the transport SDK span below the cutoff and graph-only retains it. Scanner-only retains all seven expected invocation spans by k=5 while leaving many entrypoint, branch and caller spans uncovered.
- At k=10, hybrid recovers the retention control's full source span and both graph arms still miss the import at `app.py:3`. Common config includes the model value and the dependency, while tracing the function locates its body and SDK destination. The relationship between those records still lacks the import statement in the retrieved context.
- The scanner reports 6 scanned files for the seven-file cross-file snapshot and 1 per control. `requirements.txt` enters through the shared config pass. No graph index skip or partial parse was reported. Index coverage and source-evidence completeness differ, as the missed import demonstrates.
- The dead-statement and bypass cases contain real source references to the SDK path. Static candidates can include those references even when the fixture branch does not reach the call. This benchmark validates retrieval of the guard and return spans, with runtime reachability and downstream reasoning outside its measured scope.

### Resource use

- Median preparation across nine snapshots was 2.7 ms for the scanner and 5.99 s for graph index creation. Median graph query time was 11.42 s per case, including one-shot CLI startup. Hybrid uses both preparations and both retrieval streams. These timings describe this local run and tiny fixtures.
- Median scanner peak was 143.5 KiB of Python-traced allocations. Graph indexing recorded median 47.1 MiB peak sampled Linux RSS across 9/9 snapshots, including the daemon and its workers. Python-traced allocation and sampled process RSS use different measurement scopes.
- The run used zero model calls, zero provider tokens and zero provider charges. Downstream accuracy, model version, prompt version and selected skill version are unavailable for this retrieval-only experiment. The query definitions and adapter are fingerprinted in the manifest.

## Decision

Keep the production scanner and its coverage ledger. The scanner preserves useful SDK and retention signals and the hybrid loses an indirect invocation at the tighter cutoff. The P14 controls exercise familiar holdout source pins, while the new cross-file scenarios share one authored topology. A separate reviewed cross-file holdout and an authorized downstream evaluation are still needed to justify changing the production strategy.

## Reproduce

Run from `deepagents/` with Python dependencies installed and the trusted native `codebase-memory-mcp` binary at version `0.11.0`. The binary uses a local Unix socket. Provide a fresh output directory.

```sh
uv run python -m evals.cli repository-retrieval \
  --graph-binary /absolute/path/to/codebase-memory-mcp \
  --output-dir /tmp/lcsp-repository-retrieval
```

The bench requires no provider credentials. Source pins, the binary fingerprint, exact settings and per-case evidence hashes are in [manifest.json](manifest.json) and [report.json](report.json). The source annotations are in [cross_file_cases.json](../../fixtures/benchmark/cross_file_cases.json).

Local verification covered 275 scoped Python tests, including pinned citation and scope checks, researcher mutation and execution denial, scanner and graph checks, and the P14/P17 regressions. Ruff, business-logic documentation checks and the documentation checker's five tests also passed. This run used the local native graph engine. Remote CI and Docker E2E remain pending.
