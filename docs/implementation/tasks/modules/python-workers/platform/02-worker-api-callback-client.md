---
task_id: MW-pyp-002
module: python-workers/platform
runtime: deepagents
priority: P0
status: READY_FOR_DEV
epic_story: 1.1
depends_on:
  - python-workers/platform/01-worker-platform-bootstrap.md
---

# Worker API Callback Client

## Outcome

Provide a typed HTTP client for Python workers to call NestJS API callback endpoints. Handles authentication (`X-Worker-Api-Key`), retry with exponential backoff, correlation ID injection, and safe error reporting (no secrets in error logs).

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/common/platform/api_client.py` | Modify | Expand with typed callback methods |
| `deepagents/tools/common/platform/callback_schemas.py` | Create | Pydantic models for callback request/response |

## Client Interface

```python
class WorkerApiClient:
    def post_scan_callback(self, scan_job_id: str, payload: ScanCallbackPayload) -> CallbackResponse:
        ...

    def post_technical_profile_callback(self, payload: TechnicalProfileCallbackPayload) -> CallbackResponse:
        ...

    def post_ai_usage_flow_callback(self, payload: AIUsageFlowCallbackPayload) -> CallbackResponse:
        ...

    def post_verified_profile_callback(self, payload: VerifiedProfileCallbackPayload) -> CallbackResponse:
        ...

    def post_legal_rule_match_callback(self, payload: LegalRuleMatchCallbackPayload) -> CallbackResponse:
        ...

    def post_classification_callback(self, payload: ClassificationCallbackPayload) -> CallbackResponse:
        ...
```

## Business Rules

1. Every request includes `X-Worker-Api-Key` header from `WORKER_API_KEY` env var.
2. Every request includes `X-Correlation-Id` header with current correlation ID.
3. Retry policy: 3 attempts with exponential backoff (1s, 2s, 4s). Network errors and 5xx responses are retried. 4xx responses are not retried.
4. On terminal failure (3 retries exhausted): raise `WorkerCallbackError` with safe message (no secret values).
5. Request timeout: 30 seconds per attempt.
6. All Pydantic models must have `model_config = ConfigDict(extra='forbid')` — no extra fields.
7. Callback payloads must NOT include raw source code, file contents, or full AST bodies.

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Successful callback | Response parsed, no error |
| T02 | 5xx response | Retried 3 times then `WorkerCallbackError` |
| T03 | 422 response | Not retried, raises with safe error |
| T04 | Network timeout | Retried with backoff |
| T05 | `X-Worker-Api-Key` in every request | Header inspection |
| T06 | `X-Correlation-Id` in every request | Header inspection |
| T07 | Raw source code not in payload | Pydantic model validation |

## Definition of Done

- All 6 callback methods implemented and typed.
- Retry with exponential backoff for 5xx/network errors.
- No retry for 4xx.
- Correlation ID propagated in every request header.
- No secrets or source code in error logs or callback payloads.
