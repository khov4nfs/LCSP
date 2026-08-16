# Scanner Specification

## Status
AUTHORITATIVE — PROGRAM EVIDENCE GRAPH v2 (LCSP-999)

## Purpose
Python Scanner Worker owns static repository understanding. It converts one commit-pinned snapshot into traceable technical findings plus a repository-wide `ProgramEvidenceGraph` before LLM/legal investigation.

## Principle
The scanner establishes technical facts; it never determines legal risk/compliance. Provider/package presence alone does not prove model use. Keywords alone do not prove business behavior.

## Static-only boundary
Allowed: read snapshot files; parse manifests/config/schemas/migrations/source; run approved static tools; build AST/CST internally; resolve imports/symbols/calls/data/control/framework boundaries; produce sanitized metadata/hashes/source anchors/graph/findings/coverage.

Forbidden: execute customer code; install dependencies; run customer scripts/builds/tests/Docker/CI; probe endpoints; persist raw source/full AST/full prompts/secrets/literal PII; send prohibited raw content through the LLM gateway.

## Runtime ownership
Python Worker owns orchestration and all technical processing. Syft, Knip, deptry, Semgrep, Python AST/libcst, tree-sitter and the Python-owned `ts-morph` subprocess are scanner implementation tools. NestJS owns snapshot/credential boundaries, CQRS/persistence/PBAC/protected APIs only.

## Pipeline

```text
validate ScanJob
-> restricted workspace + pinned snapshot
-> inventory/language routing
-> SBOM + dependency usage/license
-> language semantic analyzers
-> repository-wide Semantic IR
-> framework boundary linkage
-> ProgramEvidenceGraph v2
-> technical findings/report privacy+quality gates
-> verified workspace cleanup
-> callback/persistence
```

Graph construction is whole-repository and is not triggered by finding an AI invocation. Static control/data traversal may continue through imports, arguments/returns, parsers/transforms, routes, events/queues/CQRS and persistence. Every unresolved dynamic/runtime boundary is explicit.

## Program graph contract
Canonical graph behavior is defined by `program-evidence-graph-spec.md` and `scanner/program_graph/*`.

## Dependency contract
Normalize declared/discovered/used/unused/missing/transitive/uncertain package state. Preserve version/license where available. Connect package imports/usage to dependency inventory; a declared dependency is not evidence of active invocation. SDK software license is distinct from remote service terms.

## Sensitive-data contract
Separate secrets from personal/sensitive human data. Preserve field/category semantics, never literal values. Propagate category labels through statically established value-flow edges. Sanitization/anonymization is represented as a transformation and is not automatically treated as proof of irreversible anonymization.

## External integration contract
Detect statically visible HTTP/SDK/webhook/GraphQL/gRPC and AI-provider calls and safe host identity when available. Unknown endpoints remain unknown. Policy classification (allow/review/deny) occurs downstream and must not be hardcoded as universal scanner truth.

## Evidence
Material technical claims carry file/symbol/line/source-hash/graph evidence refs when available. `TechnicalEvidenceReport` persists no raw source. Quality/coverage limitations are first-class evidence state, not silently ignored.

## Reanalysis
Targeted reanalysis may refine unresolved evidence on a pinned snapshot, but it never replaces the baseline repository-wide graph contract with an LLM-selected subset.
