# LCSP-347 DATA-03.4 handoff

## Baseline and publication

- Initial local/remote PR HEAD: `e51b73d26065e1256bdb41f4baccc51ab463f38a`.
- PR #456: OPEN / Draft.
- Existing DATA-03.3 evidence preserved and referenced, not rewritten.

## Results

- Original Law 134 DOCX rehash matches SHA-256 `ced80bf1fd45a576a785994da3471d9a2fbdc54e799216e0c9dba5da62d45af7`.
- `/lcsp-data032` old queue metadata: five ready, zero unacked, zero consumers; 15-second retry queue empty. Payload inspection returned HTTP 401. All five messages remain `UNKNOWN_REQUIRES_REVIEW`; none consumed, acknowledged, purged, replayed or mapped to a document/attempt.
- Created `/lcsp-data034` in the task-labeled disposable broker, with permissions scoped to the test user and that vhost. It currently has no declared task queues, bindings, messages, or consumers.
- No PostgreSQL writes in DATA-03.4. No active-source mutation, activation, Preparation, Assessment, or paid call.
- DATA-03.3 remains the verified happy path for one unique source document: three authenticated request variants/retries, three DRAFT versions, three READY records, 265 chunks per record, VALID indexes. They represent one original source, not three corpus documents.
- Reliability gaps not closed: live API outage/recovery, worker restart with unacked delivery, real duplicate broker delivery, callback-commit/response-loss uncertainty, stale event replay against PostgreSQL, live wrong-worker identity, and wrong-source environment isolation.

## Tests

- Python `uv run --frozen pytest -q tests/test_managed_document_ingest.py tests/test_agent_runtime_rabbitmq_consumer.py tests/test_agent_server_client.py`: 101 passed, 1 warning, no failures. Provider-free tests only.
- API `pnpm exec cross-env NODE_OPTIONS=--experimental-vm-modules pnpm exec jest --config ./jest.config.ts --runInBand --runTestsByPath src/http-body-parser.spec.ts src/modules/legal-source/application/services/document-media-type.spec.ts`: 2 suites, 12 tests passed.
- No application code changed. New deliverables are sanitized technical evidence and readiness guidance.

## Next safe actions

1. Obtain management-authorized, non-destructive inspection of the five old queue messages; map each message to the document/attempt state in the disposable DB. Keep unknown messages untouched.
2. For a new fault-injection run, use a fresh disposable DB or clearly isolated test records and the empty `/lcsp-data034` vhost; start exactly one consumer queue prefix only after the isolated API and Agent Server are healthy and explicitly target the same API.
3. Exercise worker restart, API outage, callback response loss, duplicate delivery and stale attempt with actual broker/database state and captured correlation/outbox/worker IDs.
4. Confirm no provider inference path is reachable, not merely zero usage-row count.
5. Follow `official-nine-document-ingestion-readiness.md` for later corpus-wide import. Resolve legacy DOC and OCR review needs before claiming nine-document technical readiness.

## Artifacts

- `legal-source-ingestion-replay-and-recovery.md`
- `legal-source-ingestion-replay-and-recovery.receipt.json`
- `official-nine-document-ingestion-readiness.md`
- `legal-source-worker-connectivity-data033.md` and `.receipt.json` (prior successful vertical)

No merge, deployment, Legal Source activation, Rule Set Preparation, or paid model execution.
