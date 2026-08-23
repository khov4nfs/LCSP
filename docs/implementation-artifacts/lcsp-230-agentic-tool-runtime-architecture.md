# LCSP-230 — Canonical Agentic Tool Runtime Architecture

Status: implementation in `refactor/LCSP-230-agentic-tools-architecture`.

## Invariant

Every canonical LCSP tool name MUST have one real public execution function with the exact same snake_case name.

Examples:

- `run_syft_inventory` → `run_syft_inventory(...)` → `SyftTool.run(...)`
- `search_evidence` → `search_evidence(...)` → `SearchEvidenceQuery` → `SearchEvidenceHandler.execute(...)`
- `submit_classification_for_independent_review` → `submit_classification_for_independent_review(...)` → `SubmitClassificationReviewCommand`
- `request_targeted_reanalysis` → `request_targeted_reanalysis(...)` → `RequestTargetedReanalysisCommand`

Internal domain classes and methods may keep their existing names. They MUST be reached through the canonical same-name execution boundary.

## Central runtime binding

The Python orchestration runtime keeps one discoverable index in:

`lcsp-python-workers/src/lcsp_workers/agentic_evidence/dispatcher.py`

Each `ToolBinding` declares:

- `tool_name`
- `runtime_target`
- exact-name `entrypoint`
- `downstream_target`

`ALL_TOOL_BINDINGS` currently covers 55 canonical tools and fails fast on duplicate names.

Runtime targets are explicit:

- `PYTHON_LOCAL`
- `NEST_CQRS`
- `NEST_COMMAND`
- `MANAGED_AGENT_COMMAND`
- `PROTECTED_API`

## Runtime ownership

### AO-1 scanner

Canonical functions live in:

`lcsp-python-workers/src/lcsp_workers/agentic_evidence/scanner_tool_entrypoints.py`

`ScanConsumer` dispatches through `ScannerToolDispatcher` instead of knowing individual implementations such as `SyftTool.run` or `SemgrepTool.run` directly.

### Nest read/query tools

Canonical functions and the single query switch live in:

`apps/api/src/modules/evidence/presentation/http/agentic-tool-query-dispatcher.ts`

Every query case delegates to the same-name function before creating the CQRS query.

### Protected Nest mutation tools

Canonical functions and the protected command switch live in:

`apps/api/src/modules/evidence/presentation/http/agentic-tool-command-dispatcher.ts`

Before `CommandBus.execute`, the internal dispatcher re-evaluates PBAC using the current membership and policy. Policy ID/version used by review commands come from the trusted PBAC lookup, not the worker payload.

### Managed Agent command tools

Canonical functions live in:

`apps/api/src/modules/evidence/presentation/http/agentic-tool-internal-dispatcher.ts`

This currently owns:

- `request_targeted_reanalysis`
- `resume_waiting_runs`

`resume_waiting_runs` remains system-only. AO-6 recovery must not route it back through `LegalToolDispatcher`, because doing so would create a recursive tool path. The recovery driver therefore invokes the existing internal API client at the terminal resume seam after corpus activation.

### AO-6 legal corpus tools

Canonical functions live in:

`lcsp-python-workers/src/lcsp_workers/agentic_evidence/legal_tool_entrypoints.py`

Authoritative AO-6 queue consumers are no longer allowed to instantiate the corresponding builder/validator/tool and call `run()`, `build()`, `evaluate()`, `validate()`, or `extract_*()` directly. Runtime execution is now:

```text
RabbitMQ command
  -> AO-6 consumer
  -> LegalToolDispatcher.dispatch(canonical_tool_name, ...)
  -> ToolBinding
  -> exact same-name canonical function
  -> domain implementation
  -> consumer persists the returned immutable artifact
```

The migrated consumers are:

- `LegalSourceIngestConsumer` → `fetch_official_source_snapshot`
- `OfficialTextExtractionConsumer` → `extract_official_text`
- `OcrFallbackConsumer` → `run_ocr_fallback`
- `OcrQualityConsumer` → `evaluate_ocr_quality`
- `ReviewedCorpusInputConsumer` → `build_reviewed_corpus_input`
- `LegalChunkConsumer` → `build_legal_chunks`
- `ChunkIntegrityConsumer` → `validate_chunk_integrity`
- `LegalRetrievalIndexConsumer` → `build_legal_retrieval_index`

The recovery driver also crosses the canonical boundary for:

- `validate_retrieval_index`
- `activate_validated_corpus_version`

`validate_retrieval_index` now owns its Chroma round-trip validation inside the exact-name canonical entrypoint rather than calling back into the recovery driver's private method. `LegalCorpusRecoveryDriver._validate_retrieval_index()` is only a compatibility/test seam and immediately dispatches the canonical tool.

Protected corpus activation remains behind `WorkerApiClient.activate_validated_corpus_version` and is reachable through `activate_validated_corpus_version(...)` only. Draft ingest and retrieval-index registration remain explicit corpus lifecycle API operations because they are not canonical tools in the 55-tool catalog.

Source-fetch retry semantics are preserved: deterministic command-envelope errors are terminal, while fetch/runtime failures continue through the existing consumer retry/DLQ policy.

Architecture regression coverage lives in:

`lcsp-python-workers/tests/agentic_evidence/test_legal_consumer_dispatch_boundaries.py`

It fails if an authoritative AO-6 consumer bypasses `LegalToolDispatcher`, if recovery owns Chroma validation directly again, or if recovery calls the activation API directly.

## Debugging

From `lcsp-python-workers`:

```bash
python scripts/list_agentic_tool_bindings.py
```

Inspect one tool:

```bash
python scripts/list_agentic_tool_bindings.py --tool run_syft_inventory
```

Machine-readable output:

```bash
python scripts/list_agentic_tool_bindings.py --json
```

Expected trace for a developer is now:

```text
canonical tool name
  -> central ToolBinding
  -> exact same-name function
  -> runtime target
  -> CQRS / Python implementation / Managed Agent command / protected API
```

A developer should not need to infer implementation ownership from a workflow consumer or search for unrelated generic method names such as `run()` or `execute()` first.
