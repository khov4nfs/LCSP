# DATA-04 seven-document ingestion evidence

## Result

**Corpus ingestion: NOT RUN.** The evidence below is a readiness record, not an ingestion receipt. No source, version, document, outbox event, worker attempt, chunk, or index was created in this stage.

The seven official DOCX files retained under `%TEMP%/lcsp347-data031-word` were rehashed on 2026-11-12. All seven match the expected hashes and lengths in `lcsp347-seven-document-corpus-manifest.json`. The original source files were not modified or copied into Git.

## Environment preflight

- API: `http://127.0.0.1:43135/health` returned HTTP 200.
- Database identity: disposable PostgreSQL database `lcsp_data04_corpus` in task container `lcsp347-data031-postgres`; schema migrations were current.
- Initial database counts: LegalSource 0, LegalSourceVersion 0, LegalSourceDocument 0, ComplianceRuleSetVersion 0, RuleSetPreparationRun 0, Assessment 0.
- Isolated broker vhost: `/lcsp-data04`, distinct from `/lcsp-data032` and shared `/`.
- `/lcsp-data04` had zero ready and zero unacknowledged messages at inspection. Its normal API listeners already declared billing and Legal Source activation queues; those were empty. No DATA-04 Agent Runtime worker queue prefix was created.
- The authenticated Admin API was available in this disposable environment. No write request was sent during DATA-04.
- A loopback-only model guard was started, but Agent Server did not reach healthy state.

## Provider-free gate

Agent Server startup without the local-only route/guard configuration failed closed at graph initialization because the default OpenAI model had no credentials. An attempt to launch Agent Server with the local route file, loopback guard endpoint, and provider-key overrides was rejected by the execution command policy. The runtime therefore was not proven provider-free. The Python consumer was not started, and the seven-document import was deliberately not attempted.

The local guard was not contacted by any inference request. This is not evidence that the runtime would have used it. No real provider credentials were added, changed, or exposed.

## Per-document result

All seven rows: original bytes/hash verified against the expected local acquisition evidence; extraction/import/worker/callback/chunk/index `NOT_RUN`; legal effect and corpus role `REQUIRES_REVIEW`. Details are in the machine-readable manifest.

The separate Law 134 DATA-03.3 ingestion receipt remains valid for its prior single-document execution and is not reused as DATA-04 evidence.
