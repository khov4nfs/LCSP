# LCSP-347 DATA-04 handoff

## Repository and publication

- Repository: `khov4nfs/LCSP`
- Branch: `feat/LCSP-347-assessment-prompt-locales`
- Baseline HEAD: `be2358300c175d991bdcdf0451328d48bbd44cf9`
- PR #456: OPEN / Draft (reset to Draft after discovering it had been marked ready)
- Final commit and published HEAD are identified in the execution summary and PR #456 commit history.

## Retry authority: completed

Remote Agent Server error strings were previously eligible for a shared retry classifier without an authoritative boundary argument. Retry authority now travels from the canonical broker boundary dispatcher through polling/resume and is accepted for managed-document ingestion only. Serialized Agent Server metadata cannot grant authority. Permanent 4xx and malformed/unknown errors remain terminal. Assessment Root/Preparation-looking error strings remain terminal at this shared classifier; their boundary handlers and existing admission/idempotency mechanisms are unchanged.

The combined provider-free test command initially reproduced its timing-sensitive failure: the first worker thread could be scheduled after the test's 10 ms deadline, so no first-dispatch event was observed. An event-only adjustment did not solve the underlying assumption. The test now uses a deterministic injected timer for the first delivery and a long local deadline, synchronizing both dispatch entries before assertions. The final combined suite passed twice consecutively: 132 passed in 7.16s, then 132 passed in 6.42s. Ruff import checks passed; full Ruff reports 10 existing findings in the touched files, and frozen Ruff is unavailable. `compileall` passed before the final test-only adjustment; pytest imported and executed the adjusted test successfully.

## Seven-document import: blocked before writes

The seven DOCX originals were rehashed and all expected SHA-256 values and byte lengths match. The isolated API at `127.0.0.1:43135` was healthy, and `lcsp_data04_corpus` had no sources/documents/runs before the attempt. The separate `/lcsp-data04` broker vhost was empty of messages; it is isolated from old `/lcsp-data032` and shared `/`.

Agent Server first failed closed on its default model configuration due missing OpenAI credentials. The attempt to start it with the local-only model route, loopback inference guard, and blanked external provider credentials was rejected by the execution command policy. As a result the runtime could not be proven provider-free. No Python consumer was started, no Legal Source/DRAFT was created, and no document upload was issued. This was intentionally stopped before corpus writes.

The isolated API had declared its normal empty billing and activation queues; no activation event was emitted. The old `/lcsp-data032` queue with unknown messages was not accessed.

## DATA-04 disposition

| Gate | Result |
|---|---|
| Retry authority scope/tests | PASS |
| Combined test stability | PASS — 132 tests, two consecutive runs after the final deterministic test change |
| DOCX source hashes | PASS — seven expected hashes match |
| Isolated DB/vhost availability | PARTIAL — identity/emptiness confirmed; Agent Server/provider boundary not established |
| Seven-document DRAFT | NOT_RUN |
| Real ingestion worker/index | NOT_RUN |
| Human legal review | BLOCKED_EXTERNAL — 0/7 |
| Activation / Preparation / Assessment / paid inference | NOT_RUN; none occurred |

## Next required action

Provide an approved way to launch the local Agent Server with an environment-scoped model route targeting only the loopback guard and with no external provider credentials or fallbacks. Once that is verified, revalidate empty isolated DB and broker state, create one managed source and one DRAFT through the authenticated Admin API, then upload the seven hash-matched originals sequentially through the normal outbox/RabbitMQ/worker lifecycle. Validate the retrieval index against the complete final document set. Do not change source lifecycle or run Preparation.
