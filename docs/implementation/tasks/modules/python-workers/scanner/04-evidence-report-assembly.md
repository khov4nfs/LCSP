---
task_id: MW-scan-py-004
module: python-workers/scanner
runtime: deepagents
priority: P0
status: DONE
epic_story: 3.5
depends_on:
  - python-workers/scanner/02-syft-sbom-tool.md
  - python-workers/scanner/03-semgrep-ai-rules-tool.md
---

# Evidence Report Assembly and Callback

## Outcome

Assemble all scanner tool outputs into a single `TechnicalEvidenceReport` payload and submit to the NestJS API callback endpoint. Payload must include provenance metadata, privacy flags, and redacted findings. Raw source must never appear in the payload.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/evidence_assembler.py` | Create | Assembles tool outputs + validates privacy flags |
| `deepagents/tools/graph/scanner/scan_consumer.py` | Modify | Orchestrate tools + assembler + callback |

## Evidence Payload Schema

```python
@dataclass
class EvidencePayload:
    schema_version: str                 # e.g., '1.0'
    tools_version: dict[str, str]       # { 'syft': '1.x.y', 'semgrep': '1.x.y' }
    config_hash: dict[str, str]         # { 'syft': 'sha256:...', 'semgrep-ai': 'sha256:...' }
    sbom_entries: list[SBOMEntry]
    ai_usage_signals: list[SemgrepFinding]
    tool_failures: list[ToolFailureRecord]
    coverage_notes: list[str]           # Business-language coverage limitations
    privacy_flags: PrivacyFlags

@dataclass
class PrivacyFlags:
    contains_source_code: bool          # Must be False
    secrets_redacted: bool              # Must be True
    source_stripped_from_findings: bool
```

## Business Rules

1. Run all tools in sequence: Syft → Semgrep → (future tools).
2. Apply `redact_source_code()` to all findings before assembly.
3. Apply `redact_dict()` to final payload.
4. Set `privacy_flags.contains_source_code = False`. Assert before callback.
5. Set `privacy_flags.secrets_redacted = True`. Assert before callback.
6. If assertion fails: abort callback, log error, transition job to `FAILED` with `PRIVACY_ASSERTION_FAILED` error code.
7. Submit to `POST /internal/scan-jobs/:scanJobId/callback` via `WorkerApiClient`.
8. If callback returns 422 `PRIVACY_FLAGS_INVALID`: log safe error. Do NOT retry with raw source.
9. Tool failures recorded in `tool_failures` list — not blocking the callback unless all tools failed.
10. Workspace cleanup runs AFTER callback (not before).

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | All tools succeed | Full evidence payload submitted |
| T02 | One tool fails | `tool_failures` includes failure, callback still submitted |
| T03 | All tools fail | Callback submitted with empty findings, all failures recorded |
| T04 | `contains_source_code = True` detected | Abort, job `FAILED`, `PRIVACY_ASSERTION_FAILED` |
| T05 | Payload submitted, workspace then cleaned up | Cleanup order verified |
| T06 | Final payload has no source code | `redact_source_code()` applied |
| T07 | `privacy_flags` in callback body | NestJS API accepts payload |

## Definition of Done

- `contains_source_code = False` asserted before callback — abort if violated.
- `secrets_redacted = True` asserted before callback.
- Tool failures recorded but non-blocking (unless all tools failed with zero findings).
- Workspace cleanup runs after callback.
- `redact_dict()` + `redact_source_code()` applied to full payload.

## Implementation Evidence

- Added `deepagents/tools/graph/scanner/evidence_assembler.py` to assemble Syft SBOM entries, Semgrep AI usage signals, tool failure records, coverage notes, tool versions, config hashes, schema version, and callback privacy flags into the NestJS scan callback contract.
- Updated `ScanConsumer` to run Syft → Semgrep, assemble the evidence payload, submit `WorkerApiClient.post_scan_callback(...)`, and only clean up the scanner workspace after callback submission.
- Updated `ScanCallbackPayload`/`CallbackResponse` to support the active NestJS callback response/request fields while preserving existing worker callback tests.
- Hardened callback redaction for nested `evidence_payload.ai_usage_signals`; source-like findings are stripped before callback and secret patterns are redacted without redacting provenance `config_hash` values.
- Added tests for full payload assembly, partial tool failure callback, all-tools-failed callback payload, privacy assertion abort, final redaction, and callback-before-cleanup ordering.
- Validation: Python compile checks passed for changed worker files and tests. Targeted pytest passed: `deepagents/tests/test_evidence_assembler.py`, `deepagents/tests/test_scanner_workspace.py`, and `deepagents/tests/test_api_client.py` — 22 passed, 1 warning.
