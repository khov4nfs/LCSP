---
task_id: MW-pyp-001
module: python-workers/platform
runtime: lcsp-python-workers
priority: P0
status: READY_FOR_DEV
epic_story: 1.1
depends_on:
  - platform/outbox/02-outbox-publisher.md
---

# Python Worker Platform Bootstrap

## Outcome

Bootstrap the LCSP Python Worker Platform: RabbitMQ consumer base class, structured logging, PBAC preflight client, correlation ID propagation, and graceful shutdown. All domain workers inherit from this platform. No domain logic in platform layer.

## Module Files

| File                                                              | Action | Notes                                                    |
| ----------------------------------------------------------------- | ------ | -------------------------------------------------------- |
| `lcsp-python-workers/src/lcsp_workers/__init__.py`                | Create | Package init                                             |
| `lcsp-python-workers/src/lcsp_workers/platform/consumer_base.py`  | Create | Base RabbitMQ consumer with retry/DLQ and PBAC preflight |
| `lcsp-python-workers/src/lcsp_workers/platform/logging_config.py` | Create | Structured JSON logging — no secrets in output           |
| `lcsp-python-workers/src/lcsp_workers/platform/pbac_client.py`    | Create | HTTP client for `/internal/pbac/preflight`               |
| `lcsp-python-workers/src/lcsp_workers/platform/api_client.py`     | Create | HTTP client for NestJS API callbacks                     |
| `lcsp-python-workers/src/lcsp_workers/platform/correlation.py`    | Create | Correlation ID propagation utilities                     |
| `lcsp-python-workers/src/lcsp_workers/platform/config.py`         | Create | Worker config from env vars                              |
| `apps/workers/pyproject.toml`                                     | Create | Python project with pinned dependencies                  |

## Configuration (env vars)

| Variable              | Type   | Required | Notes                                |
| --------------------- | ------ | -------- | ------------------------------------ |
| `RABBITMQ_URL`        | string | Yes      |                                      |
| `RABBITMQ_EXCHANGE`   | string | No       | Default `lcsp.events`                |
| `NESTJS_API_BASE_URL` | string | Yes      | For callbacks and preflight          |
| `WORKER_API_KEY`      | string | Yes      | Shared secret for `X-Worker-Api-Key` |
| `LOG_LEVEL`           | string | No       | Default `INFO`                       |
| `MAX_RETRIES`         | number | No       | Default 3                            |

## ConsumerBase Interface

```python
class ConsumerBase:
    queue_name: str                         # Override in subclass
    routing_key: str                        # Override in subclass
    requires_pbac: bool = True              # Override to False for system-only workers

    def handle(self, message: dict, correlationId: str) -> None:
        raise NotImplementedError

    def run(self) -> None:
        # Connects, declares queue, starts consuming
        ...
```

**Message lifecycle:**

1. Receive message from RabbitMQ queue.
2. Extract `correlationId` from message headers.
3. If `requires_pbac = True`: call PBAC preflight. If deny → nack and discard. If unreachable → nack and retry.
4. Call `self.handle(message, correlationId)`.
5. On success: ack.
6. On exception: increment attempt counter. If `attempts < MAX_RETRIES` → nack (requeue). Else → nack to DLQ exchange.

## Business Rules

1. All workers must extend `ConsumerBase`.
2. Structured logging: JSON format, `correlationId` in every log line, no passwords/tokens/secrets/source code.
3. PBAC preflight called before any user-context task processing.
4. Correlation ID propagated from RabbitMQ message header through all log lines and API callback requests.
5. Graceful shutdown: on SIGTERM, finish current message, then stop.
6. Pinned dependency versions in `pyproject.toml` — no `>=` or `*` ranges for runtime deps.

## Test Cases

| ID  | Scenario                     | Expected                                                         |
| --- | ---------------------------- | ---------------------------------------------------------------- |
| T01 | Valid message + PBAC allow   | `handle()` called                                                |
| T02 | PBAC deny                    | Message discarded (nack no-requeue), `WORKER_TASK_DENIED` logged |
| T03 | PBAC preflight unreachable   | Message nacked + retry                                           |
| T04 | `handle()` raises            | Retry up to `MAX_RETRIES` then DLQ                               |
| T05 | SIGTERM during processing    | Finish current message then exit                                 |
| T06 | Log line has `correlationId` | Log output inspection                                            |
| T07 | No secrets in log output     | Log inspection — no password/token fields                        |

## Definition of Done

- `ConsumerBase` extends for all domain workers.
- PBAC preflight runs before every user-context task.
- Structured JSON logging with correlation ID.
- Graceful SIGTERM shutdown.
- Pinned dependency versions.
