---
task_id: MW-llm-001
module: python-workers/llm
runtime: deepagents
priority: P0
status: READY_FOR_DEV
epic_story: 4.1
depends_on:
  - python-workers/platform/01-worker-platform-bootstrap.md
---

# LLM Gateway Client

## Outcome

Provide a single Python LLM Gateway client used by all workers that require LLM calls. Enforces monthly cost budget, token caps per call, prompt safety rules (no raw source code), response sanitation, and provider credential isolation.

## Module Files

| File                                                         | Action | Notes                              |
| ------------------------------------------------------------ | ------ | ---------------------------------- |
| `deepagents/tools/common/llm/__init__.py`       | Create | Package init                       |
| `deepagents/tools/common/llm/gateway_client.py` | Create | LLM Gateway client                 |
| `deepagents/tools/common/llm/prompt_safety.py`  | Create | Prompt pre-flight safety check     |
| `deepagents/tools/common/llm/budget_tracker.py` | Create | Monthly token/cost budget tracking |

## LLM Gateway Configuration

| Variable                  | Type   | Required | Notes                             |
| ------------------------- | ------ | -------- | --------------------------------- |
| `LLM_PROVIDER`            | string | Yes      | `openai` \| `anthropic`           |
| `LLM_API_KEY`             | string | Yes      | Provider API key — never logged   |
| `LLM_MODEL`               | string | Yes      | e.g., `gpt-4o`, `claude-opus-4-5` |
| `LLM_MAX_TOKENS_PER_CALL` | number | No       | Default 4096                      |
| `LLM_MONTHLY_BUDGET_USD`  | number | Yes      | Hard monthly cost cap             |
| `LLM_MONTHLY_TOKEN_CAP`   | number | Yes      | Hard monthly token cap            |

## Client Interface

```python
class LLMGatewayClient:
    def complete(
        self,
        prompt: str,
        workflow_run_id: str,
        node_name: str,
        max_tokens: int | None = None,
        correlationId: str | None = None
    ) -> LLMResponse:
        ...

@dataclass
class LLMResponse:
    content: str
    input_tokens: int
    output_tokens: int
    model: str
    provider: str
    request_id: str | None
```

## Prompt Safety Rules (in `prompt_safety.py`)

Pre-flight check before every LLM call:

````python
FORBIDDEN_PROMPT_PATTERNS = [
    r'def\s+\w+\s*\(',          # Python function definition
    r'function\s+\w+\s*\(',      # JS function definition
    r'class\s+\w+[:\{]',        # Class definition
    r'import\s+\w+',             # Import statement (heuristic)
    r'```[\s\S]{500,}```',       # Long code block
]
````

If any pattern matches → raise `PromptSafetyViolation` (never send the prompt).

## Business Rules

1. `LLM_API_KEY` must never appear in logs, error messages, or any output.
2. Apply prompt safety pre-flight before every `complete()` call.
3. Track `input_tokens + output_tokens` per call. Accumulate against monthly cap.
4. If cumulative tokens > `LLM_MONTHLY_TOKEN_CAP` or estimated cost > `LLM_MONTHLY_BUDGET_USD` → raise `BudgetExceeded` before calling provider.
5. Budget tracking uses Redis or in-process counter (resettable on first day of month). If Redis unavailable: log warning and allow (budget is soft safety, not hard blocker — hard blocker via provider billing).
6. Response `content` passed through `redact_string()` before returning.
7. Correlation ID injected into provider request metadata where supported.
8. `workflow_run_id` and `node_name` are required so LangGraph-owned worker runs remain auditable, replay-safe, and attributable at node level.

## Test Cases

| ID  | Scenario                                   | Expected                                |
| --- | ------------------------------------------ | --------------------------------------- |
| T01 | Valid prompt → LLM response                | Response returned                       |
| T02 | Prompt with Python function definition     | `PromptSafetyViolation` raised          |
| T03 | Prompt with long code block                | `PromptSafetyViolation` raised          |
| T04 | Monthly token cap exceeded                 | `BudgetExceeded` raised before API call |
| T05 | `LLM_API_KEY` not in any log               | Log inspection                          |
| T06 | Response redacted                          | `redact_string()` applied               |
| T07 | `PromptSafetyViolation` — no API call made | Provider not contacted                  |
| T08 | Missing `workflow_run_id` or `node_name`   | Request rejected before provider call   |

## Definition of Done

- Prompt safety pre-flight blocks raw source code.
- Monthly token/cost budget tracked per call.
- `LLM_API_KEY` never in logs.
- Response sanitized with `redact_string()`.
- `BudgetExceeded` raised before provider call when cap hit.
- Workflow/node context required for every provider call.
