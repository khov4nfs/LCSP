# Story AO-1: Complete Structural Evidence Baseline

Status: ready-for-dev

Jira: [LCSP-158 — Structural Evidence Baseline](https://minhpnq1807.atlassian.net/browse/LCSP-158)

## Story

As a compliance workflow,
I want a complete deterministic evidence baseline for every eligible repository file,
so that later agents can reason from traceable facts and explicit coverage limits.

## Acceptance Criteria

1. Given a scan workspace, when structural augmentation runs, then every eligible in-scope file is processed or has an explicit coverage limitation; no fixed file cap silently truncates results.
2. Given scanner output, when the technical evidence artifact is built, then graph nodes, edges, and findings carry provenance, coverage state, and evidence references in a versioned TechnicalEvidenceReport chain.
3. Given source-derived data, when callback and persistence payloads are assembled, then raw source, prompts, secrets, and full AST bodies are rejected.
4. Given a tool or parser failure, when scanning continues safely, then the report records a deterministic coverage limitation or the scan follows the established terminal failure severity policy.

## Tasks / Subtasks

- [ ] Remove the structural augmentation cap; process each eligible routed Python/TS/JS file and record an explicit per-file limitation on parser failure. (AC: 1, 4)
- [ ] Build and attach a versioned Evidence Graph artifact to the scanner callback/TechnicalEvidenceReport chain, including safe provenance, coverage state, and evidence references. (AC: 2)
- [ ] Add worker integration tests for complete graph callback output, privacy rejection/redaction, and deterministic structural-parser limitations; run the full worker suite. (AC: 1, 3, 4)

## Dev Notes

- Official execution artifact: `docs/implementation-artifacts/ao-1-complete-structural-evidence-baseline.md`.
- Runtime owner: `deepagents` builds normalized facts/graph and emits the scan callback; `apps/api` validates and persists the immutable TechnicalEvidenceReport boundary.
- Reuse `StructuralAugmentor`, `EvidenceGraphBuilder`, `EvidenceAssembler`, `ScanConsumer`, and the existing scan callback handler. Do not create a parallel scanner or source-storage path.
- Scanner remains static-analysis only. It must not execute repository code, install dependencies, or expose raw source to an LLM.

### Implementation Guardrails

- Eligible means the files routed by `LanguageClassifier`/`AnalyzerRouter`; unsupported, generated, binary, minified, oversized, or quota-limited files must retain an explicit `SCAN_COVERAGE_LIMITATION` from the existing classifier/workspace boundary.
- Structural parser failure must include a safe relative file reference and a stable reason code, never exception text, raw content, or a full AST.
- Graph and callback payloads must use only relative paths, finding/evidence IDs, hashes, analysis/tool provenance, coverage metadata, and safe structural metadata.
- Versioning is immutable: each scan callback carries a new graph artifact/version; no prior report or graph is mutated.
- Preserve existing privacy gates (`redact_source_code`, `redact_dict`, `PrivacyAssertionError`) and test the callback boundary, not only isolated helpers.

### Tool Catalog Coverage

- Required baseline chain: `materialize_snapshot` → `classify_workspace_languages` → `run_syft_inventory` / `run_semgrep_rules` / language usage and semantic analyzers → `run_structural_augmentation` → `build_evidence_graph` → `validate_evidence_report`.
- This story implements or closes the artifact-boundary requirements for `run_structural_augmentation`, `build_evidence_graph`, and `validate_evidence_report`; it consumes the earlier scanner tools' safe outputs and their coverage limitations.
- Each baseline tool must emit the shared catalog request/response metadata, including bounded scope, artifact version, provenance, coverage, evidence references, and limitations.
- Per-tool implementation tasks: `docs/implementation/tasks/modules/agentic-evidence-tools/baseline-scanner-tools.md`.

### Expected Files

- `deepagents/tools/graph/scanner/parsers/structural_augmentor.py`
- `deepagents/tools/graph/scanner/scan_consumer.py`
- `deepagents/tools/graph/scanner/graph/graph_builder.py` and graph contracts as needed
- `deepagents/tools/graph/scanner/evidence_assembler.py`
- `deepagents/tests/test_structural_augmentation.py`
- `deepagents/tests/test_scanner_workspace.py` or focused scan callback integration tests
- `apps/api/src/modules/scan/application/commands/process-scan-callback/*` and API tests only if the existing callback schema requires extension.

### Verification Requirements

- Red: prove >100 eligible files are all processed; prove graph payload is absent before implementation; prove unsafe source-derived payload is rejected.
- Green: targeted unit/integration tests for all four ACs.
- Regression: `deepagents/.venv/bin/python -m pytest -q`; run relevant API callback tests if its contract changes.

### References

- [Source: docs/project-context.md]
- [Source: docs/specs/scanner-spec.md#Required Pipeline]
- [Source: docs/specs/scanner-spec.md#Static-Analysis-Only Boundary]
- [Source: docs/specs/spec-agentic-evidence-orchestration/SPEC.md#CAP-1]
- [Source: docs/specs/spec-agentic-evidence-orchestration/tool-catalog.md]
- [Source: docs/implementation/decisions/scanner-severity-tool-provenance-decision.md]
- [Source: docs/implementation-artifacts/3-6-scan-failure-severity-and-evidence-acceptance-policy.md]
- [Source: docs/implementation-artifacts/3-7-technicalevidencereport-gates.md]

## Dev Agent Record

### Agent Model Used

GPT-5 Codex

### Debug Log References

- Created from the Agentic Evidence Orchestration SPEC, scanner specification, existing implementation artifacts, and current scanner graph/callback code.

### Completion Notes List

- Story context prepared for the AO-1 execution cycle.

### File List

- docs/implementation-artifacts/ao-1-complete-structural-evidence-baseline.md

## Change Log

- 2026-08-11: Created AO-1 execution artifact and registered it for development.
