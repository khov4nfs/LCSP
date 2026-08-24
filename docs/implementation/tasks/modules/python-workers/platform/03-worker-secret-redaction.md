---
task_id: MW-pyp-003
module: python-workers/platform
runtime: deepagents
priority: P0
status: READY_FOR_DEV
epic_story: 1.1
depends_on:
  - python-workers/platform/01-worker-platform-bootstrap.md
---

# Worker Secret Redaction Utility

## Outcome

Provide a Python utility that redacts secrets and sensitive values from any dict/string before it is logged, returned in a callback payload, or persisted in a finding. Applied at structured log output, callback payload serialization, and scanner tool output processing.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/common/platform/redaction.py` | Create | Redaction utilities |
| `deepagents/tools/common/platform/logging_config.py` | Modify | Integrate redaction filter into log handler |

## Redaction Interface

```python
# Pattern-based key redaction (same logic as NestJS AuditSanitizer)
SENSITIVE_KEY_PATTERN = re.compile(
    r'password|token|secret|key|nonce|code|hash|credential|auth|api_key',
    re.IGNORECASE
)

def redact_dict(obj: dict, depth: int = 10) -> dict:
    """Recursively redact sensitive keys from a dict. Max depth 10."""
    ...

def redact_string(text: str) -> str:
    """Redact known secret patterns from free text (e.g., log messages)."""
    ...

def redact_source_code(findings: list[dict]) -> list[dict]:
    """Remove any finding field that contains raw source code (detected by heuristic)."""
    ...
```

## Secret Pattern Detection (in free text)

Apply regex to detect and replace:
- GitHub tokens: `ghp_[A-Za-z0-9]{36}` → `[REDACTED:GITHUB_TOKEN]`
- Bearer tokens: `Bearer [A-Za-z0-9._-]+` → `Bearer [REDACTED]`
- Generic high-entropy strings in `key=` / `token=` / `secret=` patterns → `[REDACTED]`

## Business Rules

1. `redact_dict()` is called on all callback payloads before serialization.
2. `redact_string()` is called in the log formatter before any log line is emitted.
3. `redact_source_code()` is called on scanner tool output before callback — strips findings that contain actual source code snippets (detected by code heuristics: `def `, `function `, `import `, `{`, `}` patterns beyond threshold).
4. Redaction is defence-in-depth — primary prevention is at policy/architecture level.
5. Max recursion depth 10 to prevent stack overflow on deeply nested payloads.
6. Redaction must be fast: < 10ms for typical 100-key dicts.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Dict with `password` key | `password` value replaced with `[REDACTED]` |
| T02 | Dict with `api_key` nested 3 levels | Value redacted at all levels |
| T03 | String with `ghp_xxx...` | Replaced with `[REDACTED:GITHUB_TOKEN]` |
| T04 | Dict with `Bearer token_value` | Token replaced |
| T05 | Deeply nested dict (depth > 10) | Stops at depth 10 — no infinite recursion |
| T06 | Finding with source code snippet | `redact_source_code()` strips finding |
| T07 | Clean dict unchanged | No false positive redactions |

## Definition of Done

- All callback payloads passed through `redact_dict()` before serialization.
- Log formatter applies `redact_string()` before line emission.
- GitHub token pattern and Bearer token pattern detected and redacted.
- `redact_source_code()` removes code-heavy findings.
- Max depth 10 (no recursion overflow).
