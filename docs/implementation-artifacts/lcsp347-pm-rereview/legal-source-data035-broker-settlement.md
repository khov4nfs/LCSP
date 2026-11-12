# DATA-03.5 broker settlement evidence

Environment was the disposable RabbitMQ container `lcsp347-data031-rabbit`, vhost `/lcsp-data034`, exchange `lcsp.events`, managed-document route `command.legal-source.document-ingest.requested.v1`, queue `data035-faults-20261112.managed_document_ingest_requested`, and delayed retry queues at 2s, 15s, 60s, and 300s.

The Agent Runtime consumer bound the single task prefix `data035-faults-20261112`. The API had application-owned queue bindings in the isolated vhost as well (including its activation-event consumer); no activation was performed and no activation event was generated. RabbitMQ read-only queue inspection after processing showed zero ready/unacknowledged messages on the managed-document main queue and its retry queues. The main queue had one consumer at that inspection. The dedicated test vhost was used by the API publisher, consumer and isolated test services.

## Settlement history

- F02 first-delivery injection returned HTTP 503 for the worker's authenticated original GET through the test fault proxy. The changed boundary surfaced a retryable failure; the consumer published a bounded delayed retry and acknowledged only after retry publication. When the proxy returned to forward mode, the same document/attempt fetched HTTP 200 and callbacked HTTP 200; database state became READY.
- F04/F05 callback fault proxy forwarded the worker callback to the NestJS API, read upstream HTTP 200 after commit, then closed the client connection before delivering that response. The worker treated the outcome as uncertain and scheduled a retry. The repeated delivery fetched the same original and callbacked successfully. Readback remained 265 chunks/265 locators, all chunk hashes valid, one VALID retrieval index.
- During environment setup, an earlier API/worker credential mismatch produced 401 and terminal events. These were not represented as a successful fault test. After aligning the isolated API and worker to one temporary credential, three affected PENDING test documents were retried via the authenticated Admin retry endpoint (attempt 2) and all reached READY. No SQL status edits were made.
- The intentional corrupt PDF produced an authenticated fetch and callback; the callback committed FAILED, with no chunks or index.

The five old messages in `/lcsp-data032` were not accessed. Their earlier UNKNOWN classification remains unresolved and requires separate authorized operational reconciliation. This report does not claim their final count is unchanged because no read or consumption was performed during DATA-03.5.

## Retry caveats

A process restart while delayed messages were outstanding was exercised; broker retry messages survived. A hard process kill during active unacknowledged extraction and a RabbitMQ node restart were not run. After the final verified queue readback, the temporary test services were stopped gracefully; no queue purge or manual acknowledgment was used.
