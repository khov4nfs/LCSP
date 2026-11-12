# LCSP-347 DATA-04 handoff

## Repository and publication

- Repository: `khov4nfs/LCSP`
- Branch: `feat/LCSP-347-assessment-prompt-locales`
- Baseline HEAD: `be2358300c175d991bdcdf0451328d48bbd44cf9`
- PR #456: OPEN / Draft (reset to Draft after discovering it had been marked ready)
- Final commit and published HEAD are identified in the execution summary and PR #456 commit history.

## Retry authority: completed

Remote Agent Server error strings were previously eligible for a shared retry classifier without an authoritative boundary argument. Retry authority now travels from the canonical broker boundary dispatcher through polling/resume. Managed-document API/typed retry errors are limited to that boundary; allowlisted transport retries also preserve existing bounded policies for legal-source acquisition, text extraction, and legal-change detection. Serialized Agent Server metadata cannot grant authority. Permanent 4xx and malformed/unknown errors remain terminal. Assessment Root/Preparation-looking error strings remain terminal at this shared classifier; their boundary handlers and existing admission/idempotency mechanisms are unchanged.

The combined provider-free test command initially reproduced its timing-sensitive failure: the first worker thread could be scheduled after the test's 10 ms deadline, so no first-dispatch event was observed. An event-only adjustment did not solve the underlying assumption. The test now uses a deterministic injected timer for the first delivery and a long local deadline, synchronizing both dispatch entries before assertions. The 132-test combined suite passed twice after that correction; three additional positive controls were then added to prove retries remain available for the existing bounded source workflows. Final expanded-suite results are recorded after rerun. Ruff import checks passed before the latest boundary-code update; rerun is pending. Full Ruff previously reported existing findings and frozen Ruff is unavailable.

The expanded retry suite passed twice after adding source-boundary compatibility controls: 135 passed in 11.35s and 135 passed in 7.55s. Ruff import checks, compileall, business-logic documentation, import policy, contract-literal policy, canonical terminology, and diff checks passed. Full Ruff reported ten pre-existing findings in touched Python files; see `lcsp347-retry-authority-review.md`.

## Seven-document import: blocked before writes

The seven DOCX originals were rehashed and all expected SHA-256 values and byte lengths match. The isolated API at `127.0.0.1:43135` was healthy, and `lcsp_data04_corpus` had no sources/documents/runs before the attempt. The separate `/lcsp-data04` broker vhost was empty of messages; it is isolated from old `/lcsp-data032` and shared `/`.

Agent Server first failed closed on its default model configuration due missing OpenAI credentials. The attempt to start it with the local-only model route, loopback inference guard, and blanked external provider credentials was rejected by the execution command policy. As a result the runtime could not be proven provider-free. No Python consumer was started, no Legal Source/DRAFT was created, and no document upload was issued. This was intentionally stopped before corpus writes.

The isolated API had declared its normal empty billing and activation queues; no activation event was emitted. The old `/lcsp-data032` queue with unknown messages was not accessed.

## DATA-04 disposition

The first pushed SHA's Docker sandbox E2E failed in `python tests/release-images.py`: its canonical terminology preflight found the retired term in the proposed source identifier and the matrix title. These were documentation-only scanner defects, not a Docker/runtime assertion. The proposed identity/title were changed to canonical current vocabulary, and the repository terminology check passes locally. At the last inspection, CI for `7b234ea33de6f1afc2cc400494c0ba1abbe44b7c` had no failed checks; API coverage, Docker sandbox E2E, Assessment Root vertical, and API unit tests remained pending. A subsequent commit will trigger a new final-head CI run.

Job evidence: https://github.com/khov4nfs/LCSP/actions/runs/43161318975/job/130993005343

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
