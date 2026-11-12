# LCSP-347 DATA-04 — Retry Authority Review

## Root cause

Agent Server terminal-result processing is shared across runtime boundaries. The prior classifier interpreted serialized remote error strings without a canonical origin, so a managed-document-shaped 429/503/transport error could be interpreted as managed-document retry authority even when it came from another boundary. The serialized error is not an authority source.

## Fix

`dispatch_agent_runtime_event` and resume pass their canonical boundary name into the terminal-result handlers. `_retryable_remote_task_error` recognizes managed-document API and typed transient errors only for `managed_document_ingest_requested`. Transport failures also remain retryable for the three other source boundaries whose existing retry schedules are explicit: `legal_source_ingest_requested`, `official_text_extraction_requested`, and `legal_change_detection_requested`. Run/result metadata is not used as a fallback. Unknown/malformed values and permanent 4xx responses remain terminal. Broker retry counts remain bounded by each existing boundary manifest.

Assessment Root and Rule Set Preparation do not gain managed-document retry authority from error strings. Their boundary handlers, admission, idempotency, Root capacity, cancellation, model retry, and billing controls were not changed. This review does not prove live paid retry behavior; no Assessment or Preparation was run.

## Stability verification

Command from `deepagents`:

```powershell
uv run --frozen pytest -q --tb=short tests/test_managed_document_ingest.py tests/test_agent_runtime_rabbitmq_consumer.py tests/test_agent_server_client.py
```

The prior flaky consumer test depended on a 10 ms real deadline and assumed the first executor thread would start before it expired; under combined-suite load the consumer correctly settled an already-expired delivery before invoking the fake dispatch. Replacing only the second-dispatch sleep with an Event was insufficient. The final test uses a controlled timer callback for the first delivery and a long test-local deadline, and waits for each dispatch to enter before proceeding. This removes scheduler-speed assumptions without changing production timeout behavior. After adding positive controls for the three existing source-boundary transport retry policies, the expanded combined suite passed twice consecutively: 135 passed in 11.35s and 135 passed in 7.55s.

Ruff 0.17.4 via `uvx`: `--select I` passed on all three touched Python files after the final boundary update. Full Ruff reports 10 pre-existing findings in the touched files (legacy import/unused-import/date-style/broad-catch items); the frozen project environment does not include Ruff. No unrelated lint cleanup was made. `compileall` and `git diff --check` passed. Business-logic documentation, import policy, contract-literal policy, and canonical terminology gates passed.

## Boundary evidence

| Scenario | Result |
|---|---|
| Managed-document 429/503 and allowlisted transport errors | Retryable only with canonical managed-document boundary; bounded broker schedule remains in force |
| Managed-document 401/403/404/422 | Terminal |
| Legal Source ingest, official-text extraction, legal-change detection transport failure | Retains each boundary's existing bounded transport retry policy |
| Unknown or malformed remote error | Terminal |
| Assessment Root with ingestion-looking remote error | Terminal Agent Server run error; no managed-document broker retry |
| Rule Set Preparation with ingestion-looking remote error | Terminal Agent Server run error; no managed-document broker retry |
| Forged run/result metadata without canonical dispatcher boundary | Terminal |
| Exhaustion, duplicate/replayed run, Root capacity/cancellation | Existing consumer/client regressions pass in the combined suite |

## Corpus gate

The database `lcsp_data04_corpus` was verified empty of Legal Source, version, document, Rule Set, Preparation-run, and Assessment rows before corpus work. The only verified DOCX inputs match the seven expected SHA-256 values in `lcsp347-seven-document-corpus-manifest.json`.

No corpus DRAFT was created. The Agent Server was first started without provider configuration and failed closed because its default OpenAI route had no credentials. A subsequent attempt to launch with the local-only route/guard configuration was rejected by the execution tool policy. Consequently there is no proof that the actual Agent Server process is restricted to the local guard, and no worker was started. This is a safety gate, not a successful provider-free preflight. Seven-document ingestion did not begin.

No Legal Source activation, Preparation, Assessment, paid model call, historical database mutation, or old-vhost message consumption occurred.
