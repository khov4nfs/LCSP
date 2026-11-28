# LCSP-409 repository retrieval review follow-up

## Design

The **symbol-conditioned** cohort reruns the 20 cases in the original pilot. The
**query-only** cohort reuses the 12 cross-file questions and their gold spans with
all exact symbol hints removed. The eight P14 questions contain explicit symbol
names and stay in the symbol-conditioned cohort. This measures discovery from
query text on one shared fixture topology. The paired queries are reported
separately and do not add independent repositories or independently reviewed gold.

| Arm | Symbol-conditioned | Query-only |
| --- | --- | --- |
| A · Scanner ranges | Rank emitted ranges by exact symbol match | Rank emitted ranges by lexical overlap |
| B · Graph traversal | Look up exact symbols and trace up to three hops | Use the existing Codebase Memory BM25 search for two seeds, then trace up to three hops |
| C · Interleaved | Alternate B and A candidates, graph first | Same merge over query-only streams |

All three arms receive the same pinned source, config and dependency context, query
input for their cohort, evidence verification and ranked output limits. A can
only return ranges emitted by discovery, while B can return related definitions.
These results apply to those strategies. A full scanner-based investigation can
also use read-only search and source traversal, which this ablation does not exercise.

Counterevidence coverage counts matched dormant, unreachable, bypass, demo/test
and hard-negative gold spans. Actual SDK invocation spans retain their original
retrieval metric. A retrieved negative span can contain a real SDK statement.
The scorer records source coverage, and downstream invocation false-positive
rate remains unmeasured. Integration evaluation needs reviewed semantic gold and
a fixed downstream model and instruction bundle with authorized inference.

## Native results

All figures below use k=5. The JSON includes k=1, 3, 5 and 10, per-case evidence,
truncation indicators, scanner candidate counts and graph call counts.

| Cohort | Arm | Precision | Span recall | F1 | Complete cases | Invocation spans missed | Counterevidence covered |
| --- | --- | --: | --: | --: | --: | --: | --: |
| symbolConditioned | A | 16.0% | 38.8% | 0.212 | 4/20 | 0 | 4/19 |
| symbolConditioned | B | 35.0% | 91.1% | 0.476 | 16/20 | 2 | 18/19 |
| symbolConditioned | C | 35.0% | 93.3% | 0.478 | 16/20 | 1 | 17/19 |
| queryOnly | A | 23.3% | 48.1% | 0.298 | 2/12 | 0 | 2/11 |
| queryOnly | B | 28.3% | 54.6% | 0.354 | 4/12 | 4 | 3/11 |
| queryOnly | C | 30.0% | 58.8% | 0.378 | 3/12 | 0 | 3/11 |

The rerun reproduced every retrieval metric from the [v1 symbol-conditioned report](../repository-retrieval-v1/report.md).

On the same 12 cross-file questions, removing exact symbols reduced graph span
recall from 93.5% to 54.6% and hybrid recall from 88.9% to 58.8%. In the
query-only cohort, the hybrid recovered all seven invocation spans by k=5, and
the graph still completed more cases overall, 4/12 versus 3/12. Both graph
strategies retrieved only 3 of 11 counterevidence spans at that cutoff.

Median effort per symbolConditioned case was 5.0 scanner candidates and 2.5 graph calls. Median warm graph query time was 4.305 s. Hybrid consumes both retrieval streams.

Median effort per queryOnly case was 5.0 scanner candidates and 2.5 graph calls. Median warm graph query time was 4.342 s. Hybrid consumes both retrieval streams.

Across nine snapshots the median scanner preparation was 2.4 ms, graph daemon startup was 7.31 s, and graph indexing after startup was 3.20 s. Median traced scanner allocation was 142.1 KiB. Median graph RSS was 51.2 MiB across 9/9 snapshots. The memory measurements have different scopes. Provider calls, tokens and charges were all zero.

## Isolation and regression coverage

The host experiment admits only trusted, checked-in synthetic fixtures. It
checks source pins before staging and after retrieval, stages regular files
with read-only mode, and isolates cache and daemon sockets in disposable scratch.
The daemon is stopped before scratch is removed on both success and failure.
This fixture boundary does not establish production Docker sandbox isolation.

The default regression suite scripts graph responses to test the complete A/B/C
report path, ranking, deduplication, shared context, pins, and failure cleanup.
The opt-in native test checks read-only staging, index rejection outside source
scope, native queries, and daemon shutdown after success and timeout. Local
verification passed 282 scoped tests and both native integration scenarios.
Keeping the current production scanner remains the decision.
Independent gold review, a separate cross-file holdout and downstream inference
remain open.

## Reproduce

From `deepagents/`, run the eval with a trusted Codebase Memory 0.11.0 native
binary and a fresh output directory.

```sh
uv run python -m evals.cli repository-retrieval --graph-binary /path/to/codebase-memory-mcp --output-dir /tmp/lcsp409-v2
LCSP_RETRIEVAL_GRAPH_BINARY=/path/to/codebase-memory-mcp uv run pytest tests/integration/test_repository_retrieval_native.py
```

[Manifest](manifest.json) · [Raw results](report.json)
