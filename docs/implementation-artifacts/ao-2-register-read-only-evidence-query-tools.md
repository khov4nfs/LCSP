# Story AO-2: Register Read-Only Evidence Query Tools

Status: ready-for-dev

Jira: [LCSP-159 — Evidence Query Tools](https://minhpnq1807.atlassian.net/browse/LCSP-159)

## Story

As a workflow agent,
I want an allow-listed, read-only tool registry over scanner artifacts and the Evidence Graph,
so that I receive bounded technical evidence without receiving raw source.

## Acceptance Criteria

1. Every tool request and response includes assessment/workflow/artifact context, correlation ID, provenance, coverage, evidence references, and explicit result limits.
2. The registry supports scan coverage, evidence search, finding detail, symbol context, bounded subgraph, static flow, and similarity queries with scope/pagination limits.
3. Tools never expose raw source, prompts, secrets, full AST bodies, or arbitrary command execution.
4. Targeted reanalysis is the only bounded mutation; it is authorized, idempotent, audited, source-preserving, and produces a new immutable artifact version.

## Tasks / Subtasks

- [ ] Define versioned `ToolCapability`, request, response, pagination, scope, provenance, and coverage contracts; register only explicit read-only capabilities. (AC: 1, 2)
- [ ] Implement artifact-backed adapters for coverage, evidence/finding, symbol, bounded graph/flow, and similarity retrieval; enforce allow-lists and deterministic limits. (AC: 1, 2, 3)
- [ ] Implement targeted-reanalysis authorization/idempotency/audit seam and add contract, PBAC, pagination, and privacy-leak tests. (AC: 3, 4)

## Dev Notes

- Official execution artifact: `docs/implementation-artifacts/ao-2-register-read-only-evidence-query-tools.md`.
- Query tools consume AO-1's persisted `TechnicalEvidenceReport.evidence_graph`; they do not scan repositories, fetch source, or infer new facts.
- Reuse the capability names and request/response envelopes in `tool-catalog.md`; an unknown tool, unbounded request, missing artifact version, or forbidden filter fails closed.
- Return evidence identifiers, relative locations, safe structural metadata, confidence, provenance, and coverage only. A response may say `UNKNOWN`/limited; it must never compensate by leaking source text.
- Preserve immutable artifact history. Reanalysis creates a new scan/evidence version and records the input artifact/version and triggering workflow state.

### Tool Catalog Coverage

- Implement the entire **Technical evidence query and verification tools** group: `get_scan_coverage`, `search_evidence`, `get_finding_detail`, `get_symbol_context`, `get_evidence_subgraph`, `trace_static_flow`, `find_similar_symbols`, `find_provider_invocations`, `inspect_data_path`, `inspect_decision_path`, `inspect_human_review_path`, and `inspect_deployment_context`.
- `request_targeted_reanalysis` is the sole mutating capability in this story; it must dispatch only approved deterministic analyzers against a validated bounded scope.
- All capabilities implement the shared invocation contract from the catalog; unknown, unregistered, or unbounded calls must be rejected before adapter dispatch.
- Per-tool implementation tasks: `docs/implementation/tasks/modules/agentic-evidence-tools/technical-evidence-query-tools.md`.

### Expected Files

- `packages/contracts/src/agentic-evidence/*` or the existing contract module
- `lcsp-python-workers/src/lcsp_workers/*` for worker-owned registry/capability implementations and read-model support, never source re-execution
- `apps/api/src/modules/*/application/services/*` only for the PBAC, audit, and persistence gateway boundary
- focused API/worker contract and privacy tests

### Verification Requirements

- Contract tests cover each registered capability, malformed/unknown calls, result limits, cursor behavior, and correlation/provenance propagation.
- Privacy tests prove nested graph/finding payloads cannot return source, prompts, secrets, or AST bodies.
- Authorization and idempotency tests prove reanalysis is the sole mutation and has an audit trail.

### References

- [Source: docs/specs/spec-agentic-evidence-orchestration/SPEC.md]
- [Source: docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md]
- [Source: docs/specs/scanner-spec.md]
- [Source: docs/implementation-artifacts/ao-1-complete-structural-evidence-baseline.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Completion Notes List

- Created from the LCSP-159 Jira Story and the versioned agentic-evidence tool catalog.

### File List

- docs/implementation-artifacts/ao-2-register-read-only-evidence-query-tools.md

## Change Log

- 2026-08-11: Created AO-2 execution artifact.
