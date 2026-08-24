---
task_id: MW-pyp-004
module: python-workers/platform
runtime: deepagents
priority: P1
status: READY_FOR_DEV
epic_story: 1.1
depends_on:
  - python-workers/platform/01-worker-platform-bootstrap.md
---

# Worker Health Check HTTP Server

## Outcome

Expose a minimal HTTP health check endpoint on each Python worker (`GET /health`) for Docker/Kubernetes readiness and liveness probes. Reports RabbitMQ connectivity status. Does not expose configuration secrets or internal state.

## Module Files

| File | Action | Notes |
|---|---|---|
| `deepagents/tools/common/platform/health.py` | Create | Minimal HTTP server (stdlib `http.server`) |
| `deepagents/tools/common/platform/consumer_base.py` | Modify | Start health server thread on `run()` |

## API Contract

**Endpoint:** `GET /health`
**Port:** `HEALTH_PORT` env var (default 8080)
**Auth:** None (internal probes only)

**Success response (200):**

```json
{
  "status": "ok",
  "rabbitmq": "connected",
  "worker": "<WORKER_NAME>"
}
```

**Failure response (503):**

```json
{
  "status": "degraded",
  "rabbitmq": "disconnected",
  "worker": "<WORKER_NAME>"
}
```

## Business Rules

1. Health server runs in a daemon thread — does not block consumer.
2. `rabbitmq = connected` when consumer has active channel. `disconnected` when channel closed or not yet opened.
3. Response contains no config values, secrets, queue names, or API keys.
4. On SIGTERM: stop accepting health requests after consumer exits (liveness probe will then fail, triggering pod replacement).

## Test Cases

| ID | Scenario | Expected |
|---|---|---|
| T01 | Consumer connected | 200 `rabbitmq = connected` |
| T02 | RabbitMQ channel closed | 503 `rabbitmq = disconnected` |
| T03 | Response has no secrets | Field inspection |
| T04 | Health port configurable via env | Verified |

## Definition of Done

- `GET /health` returns 200 when connected, 503 when disconnected.
- No secrets in response.
- Runs in daemon thread, does not block consumer.
