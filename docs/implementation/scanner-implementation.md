# Scanner Implementation

## Status

AUTHORITATIVE CROSS-RUNTIME BUILD BOUNDARY — A-TO-Z RUNNABLE MVP

## Purpose

Define the cross-runtime build boundary for Repository Scan: NestJS API job creation/query, Python Scanner Worker ownership, TS/JS analyzer bridge, persistence handoff, queue choreography, and privacy guardrails.

Python scanner process runtime, package layout, run command, tool invocation, workspace lifecycle, retry behavior, and acceptance criteria are owned by `docs/implementation/scanner-worker-implementation.md`.

## Active References

- `docs/architecture/adr/adr-023-python-worker-scanner-runtime.md`
- `docs/specs/scanner-spec.md`
- `docs/specs/domain-state-machines.md`
- `docs/specs/event-catalog.md`
- `docs/implementation/scanner-worker-implementation.md`
- `docs/implementation/python-worker-platform-implementation.md`
- `docs/implementation/persistence-implementation.md`
- `docs/implementation/queue-implementation.md`

## Build Boundary

- Static analysis only.
- No customer source execution.
- No scanner-initiated package install, build, test, Docker, CI, shell, or endpoint probing.
- No raw source, full prompt, secret, provider token, repository credential, archive, or full AST in long-term persistence, queues, audit, or LLM input.
- Python receives first-class bounded analysis.
- TS/JS analysis runs through a fixed Node.js CLI subprocess under Python Worker control.
- Syft, Knip, deptry, Semgrep custom rules and tree-sitter/custom parser are part of the active scanner toolchain.

## Boundary Decisions

| Concern | MVP Decision |
|---|---|
| Service | Python Scanner Worker |
| Canonical package topology | `deepagents` monorepo; scanner module `tools.graph.scanner` |
| Queue consumer | `command.scan.requested.v1` sole consumer |
| SBOM/dependency inventory | Syft |
| JS/TS dependency usage | Knip |
| Python dependency usage | deptry |
| Python parser stack | stdlib `ast` + `libcst` |
| TS/JS analyzer | Node.js CLI subprocess, versioned JSON stdio protocol |
| AI custom rules | Semgrep custom rules |
| Structural augmentation | tree-sitter/custom parser |
| Graph runtime | Python-native scan-local adjacency/node-edge model |
| Persistence | PostgreSQL metadata only |
| Workspace | restricted ephemeral workspace |
| Snapshot retrieval | authenticated `SnapshotServiceClient` to the API-owned internal snapshot service |
| GitHub access | GitHub Integration in NestJS API only; prohibited in scanner runtime |
| Optional `astroid` | Post-MVP evaluation only |
| HTTP analyzer service | Post-MVP scaling alternative only |

## Queue Contract

| Exchange | Queue | Routing Key | Producer | Consumer |
|---|---|---|---|---|
| `lcsp.commands.v1` | `lcsp.scan-worker.v1` | `command.scan.requested.v1` | NestJS API outbox | Python Worker |
| `lcsp.events.v1` | downstream bindings | `event.scan.completed.v1` | Python Worker outbox | TechnicalProfile projection |
| `lcsp.events.v1` | downstream bindings | `event.scan.failed.v1` | Python Worker outbox | assessment/audit projections |

The worker writes OutboxEvent in the same transaction as terminal ScanJob state. It does not publish RabbitMQ messages directly inside the domain transaction.

## TS/JS Analyzer Boundary

Command shape:

```text
node dist/tools/ts-js-analyzer/cli.js --workspace <workspace> --request <request-json>
```

Cross-runtime requirements:

- use `asyncio.create_subprocess_exec`, never shell interpolation;
- cap runtime, stdout, and stderr;
- validate versioned JSON response;
- redact failure output;
- do not install repository dependencies or execute repository code;
- on failure, record `TS_JS_ANALYZER_FAILED` and affected-file coverage limitations;
- analyzer does not access RabbitMQ or persist scanner rows directly.
- detailed Python worker subprocess handling is owned by `scanner-worker-implementation.md`.

## Graph and Evidence

Python Worker creates a scan-local graph using Python-native node/edge structures. PostgreSQL stores normalized graph metadata only. Evidence paths are stored in `TechnicalFinding.metadata.evidencePath`; no separate graph database or Node `graphology` runtime is used.

Persisted evidence includes path/symbol/line refs, hashes, versions, confidence, and redacted metadata. Source bodies and full ASTs are excluded.

Dependency/SBOM facts persist as normalized metadata: `PackageDependency`, `SBOMComponent`, and `DependencyUsageFact`. States distinguish declared, discovered, used/reachable, unused, missing, transitive, and uncertain.

## Workspace Boundary

| Item | Decision |
|---|---|
| Materialization source | internal snapshot archive endpoint authenticated with worker service credentials |
| Credential boundary | installation token and GitHub App private key never enter worker config, queue payload, logs, or memory |
| Archive handling | bounded streaming, no-store, pinned commit verification, safe extraction |
| Root | `${LCSP_SCANNER_WORKSPACE_ROOT:-.lcsp/tmp/scanner-workspaces}` |
| Naming | `{scanJobId}-{repositorySnapshotId}-{shortCommitSha}` |
| Contents | selected snapshot only |
| Cleanup | every success and terminal failure path |
| Cleanup verification | mandatory before COMPLETED |
| Cleanup failure | `SCANNER_WORKSPACE_CLEANUP_FAILED`, security audit, downstream blocked |

## Persistence Ownership

| Model | Usage |
|---|---|
| `RepositoryScanJob` | lifecycle, idempotency, runtime, terminal status, cleanup verification |
| `SourceFile` | file metadata/support/limitations |
| `CodeGraphNode`, `CodeGraphEdge` | metadata-only graph |
| `EvidenceReference` | path/symbol/line/hash refs |
| `TechnicalFinding` | normalized findings and evidence path metadata |
| `TechnicalEvidenceReport` | immutable report metadata and coverage summary |
| `AuditEvent`, `OutboxEvent` | state/security trace and queue handoff |

## Failure Behavior

| Failure | Behavior |
|---|---|
| Repository access | retryable `REPOSITORY_ACCESS_FAILED`; terminal failed event after budget |
| Single-file parser | coverage limitation and continue when safe |
| Dynamic flow | `UNSUPPORTED_DYNAMIC_FLOW`; no inference |
| Syft/Knip/deptry/Semgrep/tree-sitter failure | coverage limitation or terminal failure according to approved severity table |
| TS/JS analyzer | `TS_JS_ANALYZER_FAILED`; bounded continuation |
| Redaction/privacy/schema | fail closed |
| Cleanup | terminal `SCANNER_WORKSPACE_CLEANUP_FAILED` |
| Duplicate delivery | idempotent no-op/resume according to stored state |

## Acceptance

- Python repository produces evidence-backed imports, invocations, inputs/outputs, bounded downstream actions, and human-review signals.
- Provider import without invocation never becomes confirmed use.
- Dynamic Python paths emit uncertainty.
- TS/JS repository is analyzed through subprocess and normalized into the same finding schema.
- No raw source is stored long term or sent to LLM.
- Tool output never independently becomes legal truth, classification truth, proof of active AI use, or proof of automated decision-making.
- Completed event is staged only after quality-valid report and cleanup verification.
- Failure states expose redacted code, correlation ID, and actionable recovery.

## Verification Commands

```text
cd deepagents
poetry install
poetry run pytest
poetry run python -m tools.graph.scanner.smoke_scan --fixture golden-path-python

cd ../tools/ts-js-analyzer
npm install
npm run build
npm test
```

Integrated smoke uses real PostgreSQL and RabbitMQ; A-to-Z acceptance additionally requires approved corpus, real LLM provider, and S3-compatible storage.

## Non-Claims

- Not production deployment authorization.
- Not perfect dynamic-code analysis.
- Not legal classification logic.
- Not A2-b2 accuracy certification before implementation fixtures run.
