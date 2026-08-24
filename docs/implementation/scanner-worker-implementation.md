# Scanner Worker Implementation Specification

## Status

AUTHORITATIVE — A-to-Z RUNNABLE MVP

## Purpose

Define the Python Scanner Worker build and runtime contract. The canonical package topology is the `deepagents` monorepo, with scanner runtime under `tools.graph.scanner`. It replaces the Node.js scanner lifecycle worker and is the sole consumer of `command.scan.requested.v1`.

Python Worker Platform-wide behavior lives in `docs/implementation/python-worker-platform-implementation.md`.

## Active References

- `docs/architecture/adr/adr-023-python-worker-scanner-runtime.md`
- `docs/specs/scanner-spec.md`
- `docs/specs/domain-state-machines.md`
- `docs/specs/event-catalog.md`
- `docs/implementation/scanner-implementation.md`
- `docs/implementation/python-worker-platform-implementation.md`
- `docs/implementation/persistence-implementation.md`
- `docs/implementation/queue-implementation.md`

## Technical Stack

| Layer | Technology | Purpose |
|---|---|---|
| Runtime | Python 3.11+ | Worker process |
| Packaging | Poetry with `pyproject.toml` | Locked dependencies and environment |
| Queue | `aio-pika` | RabbitMQ command consumption |
| SBOM/dependency inventory | Syft | Package/dependency provenance |
| JS/TS dependency usage | Knip | Unused/used JS/TS dependency facts |
| Python dependency usage | deptry | Missing/unused/transitive Python dependency facts |
| Python parsing | stdlib `ast` + `libcst` | AST/CST extraction |
| AI rules | Semgrep custom rules | AI pattern signals |
| Structural parser | tree-sitter/custom parser | Cross-language structural augmentation |
| Database boundary | repository abstraction over PostgreSQL matching the canonical schema | state, evidence, audit, outbox persistence |
| Subprocess | `asyncio.create_subprocess_exec` | fixed Node TS/JS analyzer invocation |
| Graph | Python-native scan-local node/edge structures | evidence/dependency graph assembly |

The physical schema and migrations remain owned by `persistence-implementation.md`. The Python repository adapter must not create an independent schema definition.

## Package Layout

```text
deepagents/
  pyproject.toml
  tools/
    platform/
    scanner/
      main.py
      config.py
      queue/
      workspace/
      inventory/
      tools/
      parsers/
      analyzers/
      ts_js_bridge/
      graph/
      dependencies/
      evidence/
      reports/
      persistence/
      audit/
```

## Run Contract

```bash
cd deepagents
poetry install
poetry run python -m tools.graph.scanner.main
```

Startup validates required environment, PostgreSQL connectivity, RabbitMQ connectivity, fixed TS/JS analyzer executable, workspace root, and scanner/ruleset versions. Startup failure is explicit and redacted.

## Process Lifecycle

1. Load validated configuration.
2. Bind `lcsp.scan-worker.v1`.
3. Consume `command.scan.requested.v1`.
4. Acquire idempotent job lock and mark RUNNING with AuditEvent.
5. Call the authenticated internal snapshot service by scan job/snapshot reference, verify pinned commit metadata, and safely materialize the streamed archive into the restricted workspace.
6. Inventory files and enforce file/size/time bounds.
7. Run Syft, Knip and deptry where applicable.
8. Run Python AST/CST and bounded semantic analysis.
9. Invoke TS/JS analyzer subprocess for supported files.
10. Run tree-sitter/custom parser augmentation and Semgrep custom rules.
11. Normalize dependency facts, graph, evidence refs, findings, and report.
12. Persist staged metadata and run schema/privacy/quality gates.
13. Delete workspace and verify cleanup.
14. In one terminal transaction, mark COMPLETED or FAILED and create matching AuditEvent and OutboxEvent.
15. On shutdown, stop accepting jobs, finish/cancel safely, and verify active workspace cleanup.

The worker creates an OutboxEvent; an outbox publisher later publishes to RabbitMQ. The scanner does not publish directly inside its state transaction.

## TS/JS Subprocess Contract

```text
node dist/tools/ts-js-analyzer/cli.js --workspace <workspace> --request <request-json>
```

Rules:

- use `asyncio.create_subprocess_exec` with a fixed executable and argument list;
- never invoke through a shell;
- input/output use a versioned JSON schema;
- cap timeout, stdout, and stderr;
- validate stdout before normalization;
- redact stderr before audit/failure persistence;
- prohibit package installation and repository code execution;
- map failure to `TS_JS_ANALYZER_FAILED` plus affected-file coverage limitations;
- subprocess has no RabbitMQ or direct scanner-table persistence responsibility.

## Persistence and Outbox Ordering

Staged evidence may be written before cleanup, but it is not downstream eligible until terminal success.

Success ordering:

```text
persist report/findings as staged
-> report gates pass
-> workspace deletion succeeds
-> cleanup verification recorded
-> transaction:
   ScanJob = COMPLETED
   AuditEvent = SCAN_COMPLETED
   OutboxEvent = event.scan.completed.v1
```

Failure ordering:

```text
fatal stage or cleanup failure
-> best-effort cleanup
-> transaction:
   ScanJob = FAILED
   failureCode/failureReasonRef recorded
   AuditEvent written
   OutboxEvent = event.scan.failed.v1
```

Cleanup failure uses `SCANNER_WORKSPACE_CLEANUP_FAILED` and never stages a completed event.

## Workspace Security

| Control | Requirement |
|---|---|
| Root | `${LCSP_SCANNER_WORKSPACE_ROOT:-.lcsp/tmp/scanner-workspaces}` |
| Name | `{scanJobId}-{repositorySnapshotId}-{shortCommitSha}` |
| Scope | selected snapshot only |
| Retrieval | internal `SnapshotServiceClient` only; direct GitHub HTTP/SDK access prohibited |
| Credentials | worker has no GitHub token, GitHub App private key, or GitHub OAuth client |
| Archive | bounded no-store stream with traversal/link/device/decompression protections |
| Process | non-root/restricted filesystem permissions |
| Network | restricted after repository retrieval |
| Bounds | file count, file bytes, depth, and timeout |
| Redaction | deterministic before persistence |
| Cleanup | every success and terminal failure path |
| Verification | required before COMPLETED |

Do not persist source bodies, repository archives, full ASTs, credentials, or subprocess raw output.

## Failure and Retry

| Failure | Retry | Behavior |
|---|---:|---|
| Transient internal snapshot/upstream network failure | bounded | retry under queue policy; terminal `REPOSITORY_ACCESS_FAILED` after budget |
| Single-file parser failure | no job retry | coverage limitation and continue when safe |
| Dynamic/reflection boundary | no | `UNSUPPORTED_DYNAMIC_FLOW`; do not infer |
| TS/JS analyzer failure | no job retry by default | affected-file coverage limitation; continue when safe |
| Syft/Knip/deptry/Semgrep/tree-sitter failure | severity dependent | coverage limitation or terminal failure according to approved severity table |
| Privacy/redaction/schema failure | no | fail closed |
| Worker crash or broker interruption | bounded redelivery | idempotent resume/no-op according to ScanJob state |
| Workspace cleanup failure | no | terminal security failure |

Retryable job failures use the canonical 30s, 120s, and 600s backoff budget before DLQ.

## Acceptance

- Process starts through `poetry run python -m tools.graph.scanner.main`.
- Python analysis and scanner toolchain produce bounded evidence for dependencies, imports, calls, model I/O, decision and review paths.
- TS/JS analyzer protocol is validated and normalized.
- Syft/Knip/deptry/Semgrep/tree-sitter outputs are pinned, bounded, redacted, normalized and provenance-recorded.
- Duplicate command does not duplicate artifacts.
- Raw source is absent from persistent stores, queues, logs, audit, and LLM input.
- Scanner has no direct GitHub dependency; snapshot/commit scope and internal worker authentication are contract-tested.
- Completed event requires quality-valid report and verified cleanup.
- Failure contains correlation ID, safe code, and actionable recovery without sensitive content.
- Tool failure severity table is governed by `docs/implementation/decisions/scanner-severity-tool-provenance-decision.md`.

## Non-Claims

- Not production deployment authorization.
- Not perfect dynamic-code analysis.
- Not a legal classification component.
- Not implementation-readiness certification.
