---
task_id: MW-scan-py-012
module: python-workers/scanner
runtime: deepagents
priority: P0
status: READY_FOR_DEV
epic_story: 3.5
depends_on:
  - python-workers/scanner/04-evidence-report-assembly.md
  - python-workers/scanner/09-ai-invocation-detector.md
  - python-workers/scanner/11-evidence-graph-assembler.md
---

# Schema, Privacy, and Quality Gates

## Outcome

Final gate layer before the scanner worker submits the `TechnicalEvidenceReport` to the API callback. Validates: (1) evidence schema completeness, (2) provenance fields, (3) privacy flags (no source code, secrets redacted), (4) evidence quality classification. Transactionally marks `RepositoryScanJob` to terminal state. Workspace cleanup verified AFTER callback.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/evidence/schema_validator.py` | Create | Schema completeness + required fields check |
| `deepagents/tools/graph/scanner/evidence/privacy_gate.py` | Create | Privacy flags verification before callback |
| `deepagents/tools/graph/scanner/evidence/quality_gate.py` | Create | Evidence quality classification |
| `deepagents/tools/graph/scanner/evidence/terminal_state_handler.py` | Create | Mark `RepositoryScanJob` terminal + verify cleanup |
| `deepagents/tools/graph/scanner/evidence/severity_mapper.py` | Create | Map failure types to severity per decision doc |

## Evidence Quality States (TechnicalEvidenceReport)

Evidence gate mapping per `scanner-severity-tool-provenance-decision.md`:

| State | Required severity outcome | Downstream |
|---|---|---|
| `QUALITY_VALID` | All critical dimensions `ACCEPTED` or acceptable limitations | Eligible for TechnicalProfile |
| `QUALITY_INSUFFICIENT` | One or more critical dimensions `INSUFFICIENT_EVIDENCE` | No TechnicalProfile; retry hint |
| `FAILED` | Privacy, cleanup, policy, or terminal scanner failure | No downstream; alert |
| `BLOCKED` | Provenance fields missing or operator action required | No downstream; operator action |

## Severity Table (authoritative — per scanner-severity-tool-provenance-decision.md)

| Condition | Severity | `quality_state` | Retry |
|---|---|---|---|
| Unsupported language/tool not applicable | `ACCEPTED_WITH_LIMITATION` | `QUALITY_VALID` | no |
| Non-critical tool timeout with other evidence available | `ACCEPTED_WITH_LIMITATION` | `QUALITY_VALID` | optional rerun |
| **Critical tool timeout for required dimension** | `INSUFFICIENT_EVIDENCE` | `QUALITY_INSUFFICIENT` | yes |
| Tool crash before safe output | `RETRYABLE_FAILURE` | no downstream | yes |
| **Malformed tool output** | `INSUFFICIENT_EVIDENCE` | `QUALITY_INSUFFICIENT` | yes |
| Missing config hash | `PROVENANCE_BLOCKED` | `BLOCKED` | after config fix |
| Missing ruleset hash | `PROVENANCE_BLOCKED` | `BLOCKED` | after ruleset fix |
| **Redaction failure** | `PRIVACY_BLOCKED` | `FAILED` | after fix/rerun |
| **Secret detected in output** | `PRIVACY_BLOCKED` | `FAILED` | after fix/rerun |
| Raw source persisted outside workspace | `TERMINAL_PRIVACY_FAILURE` | `FAILED` (terminal) | operator incident |
| Cleanup verification failure | `CLEANUP_BLOCKED` | `FAILED` | after cleanup/retry |
| **Repository dependency installation attempted** | `POLICY_VIOLATION` | `FAILED` (terminal) | no |
| **Source execution attempted** | `POLICY_VIOLATION` | `FAILED` (terminal) | no |
| All required evidence groups present | `ACCEPTED` | `QUALITY_VALID` | no |

Critical tools for `INSUFFICIENT_EVIDENCE` threshold: `syft`, `semgrep`, `python_ast` (any one timed out with no other dimension covering it).

## Privacy Gate (CRITICAL — runs before every callback attempt)

```python
def assert_privacy_flags(payload: EvidencePayload) -> None:
    # FATAL: abort entire submission if violated
    assert payload.privacy_flags.contains_source_code == False, \
        "TERMINAL_PRIVACY_FAILURE: contains_source_code must be False"

    assert payload.privacy_flags.secrets_redacted == True, \
        "TERMINAL_PRIVACY_FAILURE: secrets_redacted must be True"

    # Scan all finding fields for code heuristics
    for finding in payload.findings:
        for field_name, field_value in finding.__dict__.items():
            if isinstance(field_value, str):
                assert not _looks_like_source_code(field_value), \
                    f"TERMINAL_PRIVACY_FAILURE: source code in finding.{field_name}"

def _looks_like_source_code(text: str) -> bool:
    if len(text) < 50:
        return False
    code_markers = ["def ", "function ", "import ", "class ", "const ", "var ", "let "]
    brace_density = (text.count("{") + text.count("}")) / max(len(text), 1)
    return any(m in text for m in code_markers) or brace_density > 0.05
```

On `AssertionError` from privacy gate:
- Log reason (redacted — no source content in log message).
- Do NOT submit callback.
- Mark `RepositoryScanJob.status = TERMINAL_PRIVACY_FAILURE`.
- Skip workspace cleanup (evidence preserved for incident investigation).
- Raise alert.

## Schema Validator — Required Fields

```python
REQUIRED_EVIDENCE_FIELDS = [
    "job_id",
    "snapshot_id",
    "schema_version",         # Must match current schema version constant
    "tools_version",          # Dict: {tool_name: version} for every tool that ran
    "config_hash",            # SHA-256 of effective tool configuration
    "findings",               # List (may be empty for QUALITY_INSUFFICIENT)
    "privacy_flags",
    "quality_state",
    "coverage_limitations",   # List (may be empty)
    "scan_graph",
    "scanned_at",             # ISO-8601 timestamp
]

REQUIRED_PROVENANCE_FIELDS = [
    "tool_name",
    "tool_version",
    "config_hash",
    "ran_at",
    "outcome",                # 'success' | 'failure' | 'timeout' | 'skipped'
]
```

Missing required field → `quality_state = FAILED`, do not submit.

## Quality Classification Algorithm

```python
def classify_quality(
    findings: list[TechnicalFinding],
    tool_provenance: list[dict],
) -> str:
    CRITICAL_TOOLS = {"syft", "semgrep", "python_ast"}

    # Critical tool timeout for required dimension → INSUFFICIENT_EVIDENCE
    # (distinct from non-critical tool timeout which is ACCEPTED_WITH_LIMITATION)
    critical_timeouts = {
        p["tool_name"] for p in tool_provenance
        if p["tool_name"] in CRITICAL_TOOLS and p["outcome"] == "timeout"
    }
    # Malformed output also → INSUFFICIENT_EVIDENCE
    malformed_output = {
        p["tool_name"] for p in tool_provenance
        if p["outcome"] == "malformed_output"
    }

    if critical_timeouts or malformed_output.intersection(CRITICAL_TOOLS):
        return "QUALITY_INSUFFICIENT"

    # Provenance-missing → BLOCKED (handled before quality gate by schema validator)
    # Privacy/cleanup/policy failures → FAILED (handled before quality gate by privacy gate)
    # Reaching here means no fatal gate failures

    ai_findings = [f for f in findings if f.finding_type not in (
        "SCAN_COVERAGE_LIMITATION", "UNSUPPORTED_DYNAMIC_FLOW"
    )]

    if len(ai_findings) == 0:
        return "QUALITY_INSUFFICIENT"

    return "QUALITY_VALID"
```

## Terminal State Transaction

After successful callback (HTTP 200 from API):

```python
async def mark_terminal_state(
    job_id: str,
    quality_state: str,
    api_client: ApiClient,
) -> None:
    # POST /internal/scan-jobs/{job_id}/complete
    # Body: {quality_state, completed_at}
    # This is idempotent — repeated calls safe
    await api_client.mark_scan_job_complete(job_id, quality_state)
```

On callback HTTP failure (retryable): retry with exponential backoff, max 3 attempts → `RETRYABLE_FAILURE`.
On callback HTTP failure (non-retryable after retries): `FAILED` quality state — job marked FAILED, alert emitted.
Note: `PROVENANCE_BLOCKED` applies only to missing config hash / ruleset hash — not to callback HTTP errors.

## Workspace Cleanup Verification

```python
async def verify_workspace_cleanup(workspace_path: str) -> bool:
    import os
    exists = os.path.exists(workspace_path)
    if exists:
        # Cleanup was supposed to happen in task 01
        raise CleanupBlockedError(f"Workspace still exists after callback: {workspace_path}")
    return True
```

Cleanup runs AFTER callback completes. If cleanup fails: `CLEANUP_BLOCKED` severity, alert emitted, job marked complete (cleanup failure does not invalidate already-submitted evidence).

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | All critical tools ran, AI findings present | `QUALITY_VALID`, submitted |
| T02 | Critical tool (`semgrep`) timeout for required dimension | `QUALITY_INSUFFICIENT`, `INSUFFICIENT_EVIDENCE` severity |
| T03 | `contains_source_code = True` | Privacy gate abort, `TERMINAL_PRIVACY_FAILURE`, NOT submitted |
| T04 | `secrets_redacted = False` | Privacy gate: `PRIVACY_BLOCKED` (redaction failure), NOT submitted |
| T05 | Secret detected in output field | Privacy gate: `PRIVACY_BLOCKED`, NOT submitted |
| T06 | Source code heuristic in finding field | Privacy gate abort |
| T07 | Missing `config_hash` | Schema gate: `PROVENANCE_BLOCKED`, NOT submitted |
| T08 | Missing `ruleset_hash` | Schema gate: `PROVENANCE_BLOCKED`, NOT submitted |
| T09 | Malformed tool output (JSON parse failure) | `INSUFFICIENT_EVIDENCE`, `QUALITY_INSUFFICIENT` |
| T10 | Zero AI findings, tools succeeded | `QUALITY_INSUFFICIENT` |
| T11 | Non-critical tool timeout, AI findings from other tools | `ACCEPTED_WITH_LIMITATION`, `QUALITY_VALID` |
| T12 | API callback returns 200 | `mark_scan_job_complete()` called |
| T13 | API callback fails 3 times → `RETRYABLE_FAILURE` | `FAILED` quality state, alert emitted |
| T14 | `npm install` run in workspace | `POLICY_VIOLATION`, terminal failure |
| T15 | Workspace exists after cleanup | `CLEANUP_BLOCKED` alert, job still marked complete |
| T16 | Privacy gate log message | No source content in log message |

## Definition of Done

- Privacy gate runs before EVERY callback attempt — cannot be bypassed.
- `contains_source_code = True` always aborts submission with `TERMINAL_PRIVACY_FAILURE`.
- All required schema + provenance fields validated before submission.
- Quality gate correctly classifies `QUALITY_VALID` / `QUALITY_INSUFFICIENT` / `FAILED` / `BLOCKED`.
- Terminal state transaction idempotent.
- Workspace cleanup verified AFTER callback.
- Severity codes match `scanner-severity-tool-provenance-decision.md` exactly.
