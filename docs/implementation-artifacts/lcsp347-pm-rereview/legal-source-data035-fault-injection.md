# DATA-03.5 — ingestion reliability fault injection

## Execution summary

Repository PR branch: `feat/LCSP-347-assessment-prompt-locales`, baseline `a4a63371ecc2873864752d962c2deae50135ee93`. The disposable PostgreSQL database was `lcsp_data035_faults` on the existing local test PostgreSQL container. RabbitMQ was the isolated vhost `/lcsp-data034`, with Agent Runtime queue prefix `data035-faults-20261112`. The old `/lcsp-data032` queue was not consumed, acknowledged, purged, replayed, or moved.

The source file was rehashed before execution: official Law 134 DOCX SHA-256 `ced80bf1fd45a576a785994da3471d9a2fbdc54e799216e0c9dba5da62d45af7` (66,110 bytes). Test source versions stayed DRAFT.

## Root cause

A managed-document API 503 was correctly raised by the boundary, but LangGraph represented the child task failure in its terminal state. `agent_server_client._raise_for_terminal_run` did not inspect that task error and converted the run to `AgentServerRunError`, a `NonRetryableAgentBoundaryError`. The RabbitMQ consumer therefore rejected the event without requeue. The queue has no dead-letter route for that consumer binding, so the document could remain PENDING after its event was settled.

## Fix

Added a dedicated `RetryableAgentBoundaryError`. Managed-document 429/5xx and HTTP transport failures now cross the Agent Server boundary with that type. The Agent Server client extracts only a bounded allowlist of transient task error types/statuses and rethrows retryable authority; unknown errors and permanent 4xx remain terminal. Tests cover retryable 429/503/transport errors and terminal 401/ValueError. The RabbitMQ settlement test now verifies this specific exception is published to the configured retry queue.

## Real-system scenarios

| Scenario | Result | Evidence |
|---|---|---|
| F01 normal upload → outbox → isolated RabbitMQ → Python worker → Agent Server → authenticated original GET/callback | PASS | Document `14687d35-17e1-445c-b720-48b6bfe5b43c`, attempt 1, outbox `outbox:5f447e117a1ea89b67718f46e11905fe4d953867b3d3e2ae157eddde4c990f44`, correlation `2fe2c6d5-7d52-484d-bcf8-820d41a5bc92`, Agent run `01a1cbef-79a8-7d02-a8ff-e1c9cde8a532`. |
| F02 controlled API 503 before original GET, then restoration | PASS | Document `dd7461bf-3dc7-47dd-989d-a411318a59ac`, outbox `outbox:fc3b7d9c4fddb784b71b7f8f1754f2ac1c21f6395baf1e0b0b5a1c4adf8d5da8`, correlation `0b34317f-41cc-4d4a-bab5-ae57fb0cf7e7`. Proxy trace records GET 503 then retry GET 200 and callback POST 200. Final state READY. |
| F03 consumer restart with outstanding delayed retry deliveries | PARTIAL | The real consumer was stopped and restarted while task-owned deliveries were in durable retry queues; those queues survived and later processed. A hard crash during active unacknowledged extraction was not injected. |
| F04 duplicate/replay after callback commit | PASS | For `e84b3d8b-bfcd-4edb-b8bb-8ad9732aac0f`, callback POST was forwarded and committed, then its response was dropped. Retry performed the same attempt's original GET and callback again. Final readback remained one set of 265 chunks/locators and one VALID index. |
| F05 callback committed, HTTP response dropped, retry observes canonical state | PASS | Same evidence as F04: first callback response was deliberately dropped after upstream HTTP 200; retry callback returned HTTP 200; final database contains 265 chunks, 265 unique locators and VALID index. No duplicate chunks. |
| F06 old previously valid attempt after a later attempt | NOT_RUN | A non-current attempt value 0 was rejected as `422 LEGAL_SOURCE_REQUEST_INVALID`; no later valid attempt existed to test overwrite resistance. |
| F07 wrong worker key | PASS | Both original GET and callback rejected with `401 SESSION_INVALID` before mutation. |
| F08 wrong source/environment | PARTIAL | A valid worker credential addressed to a nonexistent document in the isolated API received `404 LEGAL_SOURCE_DOCUMENT_NOT_FOUND`. A separate wrong-database worker was not started. |
| F09 parser failure | PASS | Synthetic corrupt PDF document `3d0bd887-b76e-4ba4-bf19-d0556b8a3d2c` settled FAILED with zero chunks and no retrieval index. |
| F10 no unauthorized execution | PASS | Independent DB readback: zero activations, zero Preparation runs, zero Assessments and zero LlmUsageEvent rows. Provider route configuration had one local-only guard route, no fallbacks; local stub recorded no POST. |

## Durable readback

F01, F02, F04/F05, and the normal technical retries ended READY. Each Law 134 record has byte-for-byte source/blob SHA parity, 265 chunks, 265 unique locators, valid per-chunk hashes and a VALID index with content hash `sha256:1c3947275cd3736ad198768bbcba09189e0454e5c05a5355e888c2c5c6232f60`. Each test version remained DRAFT. Corrupt fixture ended FAILED with zero chunks/index. Three documents first left PENDING during a harness credential mismatch were retried using the supported authenticated Admin retry API (attempt 2); all reached READY after credentials were aligned. No direct status SQL was used.

The old queue `/lcsp-data032` was not accessed. New-vhost readback showed zero ready and unacknowledged messages on the managed-document queue after processing; one consumer remained attached at the time of inspection. Other application-owned bindings existed in the dedicated vhost, but no activation event was published.

## Verification

- `uv run --frozen pytest -q --tb=short tests/test_managed_document_ingest.py`: 43 passed.
- `uv run --frozen pytest -q --tb=short tests/test_agent_runtime_rabbitmq_consumer.py`: 48 passed.
- `uv run --frozen pytest -q --tb=short tests/test_agent_server_client.py`: 18 passed.
- Combined execution initially had one timing-sensitive consumer test failure; rerunning that exact test alone passed. The three suites then passed individually.
- `uv run --frozen ruff ...` was NOT_RUN because Ruff is not installed in the frozen environment (`program not found`).
- `git diff --check`: PASS.
- The targeted PostgreSQL/RabbitMQ/Agent Server/worker verticals above are real local integrations; no mock result is substituted for them.

## Limits

This is ingestion reliability evidence, not independent legal review or a corpus-completeness determination. The legacy `/lcsp-data032` messages remain an unrelated UNKNOWN reconciliation item. DATA-03.5 does not establish hard-crash recovery during an active unacknowledged parse, a genuinely superseded older attempt, or wrong-database isolation.
