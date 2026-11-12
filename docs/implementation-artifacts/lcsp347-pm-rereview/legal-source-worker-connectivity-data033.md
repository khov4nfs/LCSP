# LCSP-347 DATA-03.3 — Worker connectivity and ingestion receipt

Date: 2026-11-12 (local development verification)
Repository HEAD: `b9ad65585b63ca9ee5e1cff41b9b63dd0e967713`
PR #456: OPEN / Draft; no source-code changes in this verification.

## Root cause

The original `httpx.ConnectError` was raised before the managed-document boundary ran. The actual Python process was the native Windows interpreter `deepagents/.venv/Scripts/python.exe` (Python 3.11.16). The RabbitMQ consumer dispatches managed-document events to the local LangGraph Agent Server at `http://127.0.0.1:2024`; that server was not running in the earlier test setup. The error was therefore a refused TCP connection to the absent Agent Server, not a Docker-hostname or worker-to-Nest API routing failure.

After launching the supported local Agent Server, its inherited `NESTJS_API_BASE_URL` initially resolved to the shared development API on port 4000. The agent requested the document there and received an application 404. This diagnostic misrouting was corrected by explicitly setting `NESTJS_API_BASE_URL=http://127.0.0.1:43132` in both Agent Server and consumer, where the isolated Nest API listened on loopback. The 404 did not mutate the shared database. A separate temporary API harness initially returned 413 for the callback because it omitted the repository's normal `httpBodyParser()` setup; the harness was corrected to install the production body-parser path. No production code or security control was changed.

## Verified environment and boundary

- Disposable PostgreSQL: container `lcsp347-data031-postgres`, database `lcsp_data032_http_worker`, test role `lcsp_test`, loopback port 55445.
- Disposable RabbitMQ: container `lcsp347-data031-rabbit`, vhost `/lcsp-data032`, loopback port 5678.
- Isolated API: loopback `127.0.0.1:43132`; Agent Server: `127.0.0.1:2024`; Python consumer: native Windows process. Worker API target was explicitly set to the isolated API.
- Source: official Law 134 DOCX, 66,110 bytes, SHA-256 `ced80bf1fd45a576a785994da3471d9a2fbdc54e799216e0c9dba5da62d45af7`.
- Admin authentication used a disposable account in the test database through `/auth/sign-in`; the returned bearer token and generated password are not recorded here.
- A test-only placeholder `MIRAI_API_KEY` was present solely because the Agent Server eagerly constructs its model client. The trusted managed-document system-event boundary terminated execution before model inference. Database `LlmUsageEvent` count remained zero. This is not provider or paid-model readiness evidence.

## End-to-end attempt receipts

All three attempt-2 rows were retried through the authenticated Admin retry endpoint after the attempt-1 misrouting/harness failures. The normal service generated the retry/outbox identity; no document status or attempt number was updated directly in SQL. For each successful attempt the real worker's authenticated original-byte GET returned HTTP 200 and callback POST returned HTTP 200. Agent Server execution logged `LEGAL_SOURCE_DOCUMENT_INGESTED`, `applied=True`, `outcome=READY`, and 265 chunks.

| Scenario | Document | DRAFT version | Outbox | Correlation | Agent thread / run | Result |
|---|---|---|---|---|---|---|
| Authenticated upload A | `637a96fc-4b7e-464a-8286-9cbfe920b668` | `00b8ec4c-6fb5-4852-8830-bc01b55bdeba` | `outbox:9aa28e4b672bb41a66dbe6bb76b5e53397d717e4e5189303fbfb5b7889caf344` | `631bef91-3abb-4c41-9795-b96e3a2c2a79` | `fecbc9ed-38a2-5cc5-9db7-165edeefd4eb` / `01a1cbb7-4ae5-77d3-8264-232ac3383994` | READY; 265 chunks; index VALID |
| Authenticated upload B | `94983e3a-f465-4fac-972a-24bfecd81021` | `bfbe8ea7-a455-40ea-a088-589d5aa43c44` | `outbox:be815911610ebf53826b9461821e0d949cd6cc2b8cc09800c9336643f573fcf0` | `80a31867-9075-4a8d-81c2-507f33c912a2` | `e2b13726-147a-58b2-8be1-25b91bc289c7` / `01a1cbb7-50df-79d3-9d47-533b658662f0` | READY; 265 chunks; index VALID |
| Authenticated URL import | `79c06b08-aebc-4e05-9400-f3af4591f6cc` | `fa7328eb-2201-4105-94fb-a0032b91085c` | `outbox:5c4327f77ea9d07d3c555300a4f19680fde01fa8cb5b0504b2cab9ef866e9828` | `fa996a25-ed24-487b-ab9f-dcb53ddbdaa5` | `37521d36-5ba2-5966-bb8c-08b431a8e996` / `01a1cbb7-54fc-75e1-8230-0415226f5f60` | READY; 265 chunks; index VALID |

The second URL-import run's Agent Server request ID was `115f73f2-d8b4-48d7-a001-dc1fcebd91e3`; upload B request ID was `2fb5a3be-312a-4915-8b18-1319e42c4e07`. The upload A request ID was not captured. Rabbit publisher message IDs and broker delivery tags were not captured; they are explicitly NOT_CAPTURED rather than inferred from outbox IDs.

Attempt 1 for document `637a96fc-4b7e-464a-8286-9cbfe920b668` was settled after the misconfigured Agent Server targeted shared port 4000 and got 404. The normal authenticated retry created attempt 2, which completed. This prior diagnostic failure is retained as history; it is not counted as success or concealed.

## Independent persisted-state and content checks

After callback, independent database readback found all three documents READY at ingestion attempt 2, all three source versions still DRAFT, zero activation records, zero Preparation runs, and zero `LlmUsageEvent` rows. Stored original and content-addressed blob bytes are 66,110 bytes and match the source SHA-256 above. Each has 265 persisted chunks, 265 unique locators and a VALID `LegalRetrievalIndex`. Stored chunk hashes were recomputed and matched their content.

A separate provider-free run of the actual managed DOCX extractor over the retained original produced tool `managed-document-ingest:docx-xml` version `1.1.0`, profile `ARTICLES`, 48,832 extracted characters, text SHA-256 `sha256:6370b7cbb224af43601d2c5e94f21e2c566d5e956fcb40a0dd54db94a71eb4e9`, no parser gaps, and 35 article headings numbered 1–35. Vietnamese diacritics and document number `134/2025/QH15` were present. This verifies technical extraction consistency, not complete legal-text coverage, legal effect, corpus role, or semantic correctness. Page-linked comparison of all clauses, tables and annexes remains NOT_PROVEN; independent human legal review remains required.

## Residual broker and service state

No queue was purged or manually acknowledged. At final inspection the active test queue prefix's ingestion queues had zero ready/unacknowledged messages and no consumer. A prior task-owned queue under prefix `data032-32fd4612cf7d` retained five ready messages due both task prefixes being bound to the isolated topic exchange; it had no consumer and was left untouched. This is residual task-vhost state, not a shared/historical broker queue. Use a fresh isolated vhost or one unique bound prefix for future tests and reconcile those messages before any consumer is started.

The API, consumer and Agent Server processes started for this test were stopped after verification. The disposable PostgreSQL and RabbitMQ containers remain running. No shared/historical database, active Legal Source, or original snapshot was mutated.

## Focused regression verification

- `cd deepagents; uv run --frozen pytest -q tests/test_managed_document_ingest.py tests/test_agent_runtime_rabbitmq_consumer.py tests/test_agent_server_client.py` — **101 passed**, 1 warning, 0 failed. The warning is the existing duplicate-name adversarial ZIP fixture.
- `cd apps/api; pnpm exec cross-env NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config ./jest.config.ts --runInBand --runTestsByPath src/http-body-parser.spec.ts src/modules/legal-source/application/services/document-media-type.spec.ts` — **2 suites, 12 tests passed**.
- `git diff --check` — run for the evidence publication diff; no production source changed.

These deterministic tests supplement, but do not replace, the real disposable PostgreSQL/RabbitMQ/worker evidence above. Retry-after-worker-restart, callback-connection-loss, stale-message handling and the full negative-security matrix were not all exercised in this pass.

## Disposition

- Worker `ConnectError` root cause: **CONFIRMED** — Agent Server absent at `127.0.0.1:2024` in the earlier consumer-only setup.
- Corrected worker-to-API connectivity and three authenticated ingestion attempts: **PASS** for the stated disposable environment.
- URL import: **PASS** through authenticated API, persistence, outbox and the same worker vertical for one document.
- Full extraction/content completeness and legal correctness: **NOT_PROVEN**.
- Activation, Preparation, paid model calls: **NONE**.
- Production-code changes: **NONE**; the issue was a test-runtime topology/configuration omission.
- PR remains OPEN / Draft; no activation, merge or deployment.
