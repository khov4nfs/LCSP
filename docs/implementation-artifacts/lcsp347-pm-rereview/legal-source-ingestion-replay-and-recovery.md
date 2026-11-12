# DATA-03.4 — Ingestion replay and recovery

Date: 2026-11-12. Baseline `e51b73d26065e1256bdb41f4baccc51ab463f38a`; PR #456 OPEN/Draft.

## Residual DATA-03.3 queue

Read-only `rabbitmqctl list_queues -p /lcsp-data032 ...` observed five READY messages and zero unacknowledged/consumers in `data032-32fd4612cf7d.managed_document_ingest_requested`; the associated 15-second retry queue had zero messages. This confirms queue metadata only. It does not reveal event bodies, document IDs, attempts, timestamps, or database settlement status.

The RabbitMQ management endpoint returned HTTP 401 for the protected task-user credential, and no management-authorized inspection credential is available in this session. No `basic.get`, ack, purge, replay, or consumer start was performed. The five messages are therefore each classified collectively as `UNKNOWN_REQUIRES_REVIEW`; none is safe to replay based on present evidence. Prior successful document/attempt identities are listed in the DATA-03.3 receipt, but no mapping between those identities and these five broker messages was established.

## Isolation

Created a new empty RabbitMQ vhost `/lcsp-data034` in the task-labeled disposable broker `lcsp347-data031-rabbit`. Only task user `lcsp_data032` received permissions, scoped to this vhost. No exchange, queue, binding, consumer, or message exists there yet. The old `/lcsp-data032` vhost and its five ready messages were left intact. The task user has broad configure/write/read rights *within the isolated test vhost* because the app/worker must declare their test resources; do not reuse it outside this disposable broker.

Before a recovery experiment, use one queue-prefix only, start the isolated API on the disposable database and new vhost, ensure the Agent Server and consumer both use that API base URL, and verify the consumer-declared queue/bindings before publishing. A queue prefix on the old vhost is insufficient isolation because both prefixes were bound to `lcsp.events` and received fanout copies for matching routing keys.

## Scenario evidence

| Scenario | Result | Evidence / boundary |
|---|---|---|
| R01 normal successful delivery | PASS (reused DATA-03.3 evidence) | Three authenticated attempt-2 ingestions completed; receipts and persisted states in `legal-source-worker-connectivity-data033.md` and its JSON receipt. Not rerun. |
| R02 API outage before original fetch, then recovery | NOT_RUN | No new message dispatched and no fault injected. |
| R03 graceful worker stop/restart with outstanding delivery | NOT_RUN | No consumer started against residual queue. |
| R04 duplicate broker delivery | NOT_RUN (real broker) | Deterministic stale/settled-delivery unit coverage exists; no live duplicate was injected. |
| R05 callback committed but response lost | NOT_RUN | No callback proxy/fault injection was used. |
| R06 superseded stale attempt | PARTIAL | Provider-free worker-boundary tests cover stale/settled deliveries; not exercised against live PostgreSQL/RabbitMQ in this pass. |
| R07 wrong worker API key | NOT_RUN (live) | Existing app guards remain unchanged; no live negative HTTP request in this pass. |
| R08 wrong source/database environment | NOT_RUN | No cross-environment dispatch attempted. |
| R09 malformed parser input | PASS (deterministic unit) | Managed-document tests assert corrupt/unsupported extraction failure; no live callback/state transition test in this pass. |
| R10 no paid model execution | PASS for DATA-03.3 run; NOT_RUN as DATA-03.4 fault test | Prior receipt records zero usage rows and no model dispatch at the trusted system-event boundary. This pass started no API, Agent Server, or worker. |

The focused Python tests exercise worker retry scheduling, stale delivery guards, client continuation, and extraction failure with fakes; they are not real-broker restart/callback-loss proof.

## Current data and side effects

No PostgreSQL connection or writes were made in DATA-03.4. No source or activation data was modified. No consumer or Agent Server was started. No Legal Source was activated; no Preparation/Assessment run or paid model call occurred. The RabbitMQ change was limited to adding the empty `/lcsp-data034` vhost and scoped test-user permissions.

The DATA-03.3 document results remain three READY documents across three DRAFT versions, with 265 chunks each and valid indexes. Do not count those as three distinct original documents: all use the same Law 134 source bytes.

## Commands and checks

- Read-only queue metadata: `docker exec lcsp347-data031-rabbit rabbitmqctl list_queues -p /lcsp-data032 name messages_ready messages_unacknowledged consumers` — five ready, zero unacked/consumers on the old managed-document queue; retry queue empty.
- Management payload inspection attempt: HTTP 401; no payload was retrieved and no mutation occurred.
- New isolated vhost: `rabbitmqctl add_vhost /lcsp-data034`; `rabbitmqctl set_permissions -p /lcsp-data034 lcsp_data032 '.*' '.*' '.*'` — successful. Vhost has no declared task queues/bindings yet.
- Python: `uv run --frozen pytest -q tests/test_managed_document_ingest.py tests/test_agent_runtime_rabbitmq_consumer.py tests/test_agent_server_client.py` — 101 passed, 1 warning, 0 failed.
- API: `pnpm exec cross-env NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config ./jest.config.ts --runInBand --runTestsByPath src/http-body-parser.spec.ts src/modules/legal-source/application/services/document-media-type.spec.ts` — 2 suites, 12 tests passed.

## Remaining gate

Do not start a consumer on `/lcsp-data032` until the five messages are inspected and each mapped to its canonical document/attempt state. Obtain RabbitMQ management-authorized read access or an approved broker-native inspection method. For subsequent reliability tests, use `/lcsp-data034` with a single queue prefix, disposable DB state, and explicit process-level API/Agent Server/consumer topology. The available tests and DATA-03.3 happy path do not yet prove worker restart, uncertain callback settlement, or live duplicate/replay recovery.
