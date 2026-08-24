---
task_id: MW-scan-py-003
module: python-workers/scanner
runtime: deepagents
priority: P0
status: READY_FOR_DEV
epic_story: 3.5
depends_on:
  - python-workers/scanner/01-scanner-workspace-setup.md
---

# Semgrep AI Usage Rules Tool

## Outcome

Run Semgrep with LCSP-custom rulesets to detect AI provider API usage, LLM framework patterns, and agent orchestration signals. Findings are structural metadata only — no raw code snippets or secret values in output.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/graph/scanner/tools/semgrep_tool.py` | Create | Semgrep runner + output parser |
| `deepagents/tools/graph/scanner/rulesets/lcsp-ai-usage.yaml` | Create | Custom Semgrep rules for AI usage detection |
| `deepagents/tools/graph/scanner/rulesets/lcsp-secret-detect.yaml` | Create | Custom rules for secret leak detection (for redaction, not reporting) |

## Semgrep Rulesets

**`lcsp-ai-usage.yaml` — Detection targets:**

| Rule ID | Pattern Target | Signal Type |
|---|---|---|
| `lcsp.openai-client` | `openai.OpenAI()`, `import openai` | `provider_integration` |
| `lcsp.anthropic-client` | `anthropic.Anthropic()`, `import anthropic` | `provider_integration` |
| `lcsp.langchain-import` | `from langchain` | `framework_usage` |
| `lcsp.autogen-import` | `import autogen` | `agent_pattern` |
| `lcsp.model-call` | `.chat.completions.create(`, `.messages.create(` | `model_call` |
| `lcsp.embeddings-call` | `.embeddings.create(` | `model_call` |
| `lcsp.llm-api-key-ref` | `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` in env usage | `provider_integration` |

## Output Schema

```python
@dataclass
class SemgrepFinding:
    rule_id: str
    signal_type: str            # provider_integration | model_call | framework_usage | agent_pattern
    file_path: str              # Relative path only
    line_start: int
    line_end: int
    message: str                # Rule message only — no code snippet
    severity: str               # 'INFO' | 'WARNING' (never 'ERROR' for AI usage signals)
```

## Business Rules

1. Run: `semgrep --config lcsp-ai-usage.yaml <workspace_path> --json --no-git-ignore`.
2. Parse findings into `SemgrepFinding` list.
3. Strip `extra.lines` (actual source code) from all findings before storing. Only `message` from ruleset retained.
4. File paths: relative to workspace root only.
5. Tool version pinned. Config hash recorded (`sha256(lcsp-ai-usage.yaml)`).
6. Run `lcsp-secret-detect.yaml` in isolation — output is used ONLY to drive redaction of other findings, NOT stored or returned as evidence.
7. Timeout: 180s. Kill and record `tool_timeout` if exceeded.
8. Semgrep failure: `coverage_limited` (non-blocking per severity table).

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | File with `import openai` | Finding: `lcsp.openai-client`, `provider_integration` |
| T02 | File with `.chat.completions.create(` | Finding: `lcsp.model-call`, `model_call` |
| T03 | No AI usage | Empty findings |
| T04 | `extra.lines` stripped | No source code in `SemgrepFinding` |
| T05 | Config hash recorded | `sha256(lcsp-ai-usage.yaml)` in provenance |
| T06 | Semgrep timeout | `tool_timeout` recorded, scan continues |
| T07 | Secret detect output not in evidence | Secret findings not in callback payload |

## Definition of Done

- Source code (`extra.lines`) stripped from all findings.
- Only rule message retained in finding output.
- Secret detection findings never included in evidence callback.
- Config hash recorded for each ruleset file.
- Non-blocking on failure.
