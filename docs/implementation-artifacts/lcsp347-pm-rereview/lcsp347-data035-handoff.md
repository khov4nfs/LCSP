# LCSP-347 DATA-03.5 handoff

## Outcome

The confirmed ingestion retry defect is fixed in code and covered by focused provider-free tests. A real controlled API 503 was followed by a bounded RabbitMQ retry and a READY Law 134 document. A separate callback-response-loss run committed the callback, dropped only the HTTP response, then retried and settled without duplicate chunks. The real worker also recorded a corrupt PDF as FAILED with no chunks or VALID index. The integration used disposable PostgreSQL `lcsp_data035_faults` and isolated RabbitMQ `/lcsp-data034`.

Publication is pending the final exact-path commit and normal push. Baseline and remote branch HEAD were `a4a63371ecc2873864752d962c2deae50135ee93`; PR #456 must remain OPEN/Draft.

## Verified boundaries

- Law 134 original SHA-256: `ced80bf1fd45a576a785994da3471d9a2fbdc54e799216e0c9dba5da62d45af7`.
- Test sources remained DRAFT; zero activation records, Preparation runs, Assessments, and LlmUsageEvent rows.
- Provider route pointed only at a local rejecting test stub, with no fallback; stub saw zero inference POSTs.
- Wrong worker key returned 401 for original fetch and callback; valid key plus unknown document returned 404.
- Old vhost `/lcsp-data032` was not accessed or modified.
- Hard crash mid-active-delivery, a genuinely superseded old attempt, and wrong-database isolation remain unverified.
- Nine-document batch ingestion was intentionally not run.

## Root cause

The Agent Server client collapsed a remote transient managed-document task error into its terminal `AgentServerRunError` type. The broker consumer treats that exception as nonretryable, settling the original event rather than publishing a bounded retry.

## Fix

A dedicated retryable boundary exception now preserves transient HTTP 429/5xx and allowlisted network failures across the Agent Server task boundary. Permanent and unknown failures stay terminal. Tests verify this classification and bounded RabbitMQ retry settlement.

## Local verification

- Managed-document Python tests: 43 passed.
- RabbitMQ consumer Python tests: 48 passed.
- Agent Server client Python tests: 18 passed.
- One combined run had a timing-sensitive deadline test fail; the exact test passed when rerun alone, and all three suites passed separately.
- Ruff was unavailable in the frozen environment. `git diff --check` passed.

See `legal-source-data035-fault-injection.md`, its JSON receipt, and `legal-source-data035-broker-settlement.md` for identities and scenario detail.

## Publication

Code and regression commit: 0bd49c00d. This handoff update is committed in the publication documentation commit. Final published HEAD and GitHub check conclusions are recorded in the turn handoff after push; CI is not claimed green before checks complete.

