# Authored EN/VI translation operations

Assessment execution persists canonical identities, facts and decisions. Presentation locale
selects a separate translation bound to the exact source revision and SHA-256. Switching
locale must not rerun an assessment or change answers, selected rules or decisions.

## Native provider configuration

The API's authored translation worker can now use the existing private Agent Server:

```dotenv
LCSP_AGENT_SERVER_URL=http://127.0.0.1:2024
WORKER_API_KEY=<same internal credential used by the Agent Server>
LCSP_AUTHORED_TRANSLATION_WORKER_ENABLED=1
```

Use the deployment's actual private Agent Server address; containers use their reachable
service address rather than the host's loopback. No additional translation key is required.
The model and provider credentials remain governed by
`deepagents/config/model_routes.yaml`, role `response-transform`.

The Agent Server must also have its existing approved instruction bundle configured with
`LCSP_RUNTIME_INSTRUCTION_MANIFEST` and `LCSP_APPROVED_INSTRUCTION_MANIFEST_SHA256`.
Use the release-authorized bundle and digest; do not generate approval evidence or disable
the bundle check to enable translation. Missing bundle configuration causes BUNDLE_MISSING
before model inference. The new endpoint reports 503 and never records a successful candidate.

An explicit `LCSP_AUTHORED_TRANSLATION_URL` retains the external-provider behavior and
requires `LCSP_AUTHORED_TRANSLATION_KEY`. It takes precedence over native routing; a
partially configured external provider does not silently fall back to native routing.
Malformed URLs and protocols other than HTTP/HTTPS are treated as unavailable.
The example environment leaves the worker disabled until the endpoint and its approved
instruction bundle are deployed; enable it explicitly as shown above after rollout.

`GET /admin/localization` reports `workerEnabled` and `providerConfigured`. The latter
means address and credentials are present, not that the provider has passed a live health
or linguistic verification check.

## Rollout order

1. Build the API and Agent Server with this change. The native endpoint is
   `POST /internal/authored-translation`; it is authenticated with `x-worker-api-key`
   and must remain private.
2. Roll out the Agent Server using the existing drain/replacement procedure so active
   assessments finish safely. Do not replace a running container merely to test translation.
3. Configure and restart the API with the worker enabled only after the endpoint is deployed.
   Enabling against an older image would consume retries on HTTP 404 responses.
4. Inspect `/admin/localization` and the localization operations queue at
   `/admin/compliance-rule-sets`.
5. Review source-language evidence for queued fields. UNKNOWN/MIXED or unreviewed fields
   intentionally remain blocked; enabling the worker does not approve them.
6. The worker creates translation candidates. An authorized independent reviewer approves
   target-language candidates before they become usable READY revisions. Provider failure,
   timeout, invariant violation or disabled model localization is a retryable provider error,
   never a successful translation of unchanged source text.

This rollout does not authorize automatic approval of runtime questions, legal rules or
reports. That would require a separate product-policy change.

## Historical records

Existing records without jobs need the bounded, idempotent backfill command:

```powershell
pnpm --filter @lcsp/api backfill:authored-content <scopeId> <entityType> <afterCursor> <batchSize>
```

Use the pinned rule-set version ID as the scope for ASSESSMENT_RULE and
LEGAL_REQUIREMENT. Use the assessment ID for HUMAN_REQUEST, DECISION and EVENT.
For the first batch, omit cursor and batch size to use the script defaults. Persist the
printed cursor and continue until complete. Inspect the script before invoking REPORT:
it requires an explicit artifact ID and verifies canonical artifact bytes. Backfill queues
work; it neither guesses source language nor grants review approval.

Read fallback is explicitly marked in BFF detail, question and rule-catalog responses.
Rule catalog fallback retains PENDING readiness and does not enable starting an audit as
though its translation were approved. Reports retain their strict translation checks.
The localized upstream request may still log 409 before the BFF reads canonical content;
assess the final BFF response separately from the first upstream attempt.

## Verification

- API configuration tests cover native authentication, external overrides and missing keys.
- Agent Server endpoint tests exercise EN to VI and VI to EN, authentication, hash and
  locale validation, successful candidate shape and provider failure without paid model calls.
- Before releasing, verify real approved EN/VI data and switching languages during a
  running assessment in an authenticated browser. Provider-backed translation fidelity and
  production backlog completion are separate from mocked transport tests.

Review verification on 2026-11-16:

- API and Web typechecks and lint on the changed TypeScript files passed.
- Seven provider-routing tests passed, including partial external configuration and invalid URLs.
- Twenty-five Web tests passed across fallback, locale authority, locale caches and the rule picker.
  Coverage includes EN/VI detail, questions and rules, errors that must not fall back,
  invalid fallback responses and a fallback on a later catalog page blocking audit selection.
- The Python review run passed 50 tests and exposed an incorrect inventory review status.
  After restoring `PENDING_INDEPENDENT_REVIEW`, the failed test and six related tests passed.
  These checks ran in temporary, network-disabled containers with the checkout mounted read-only;
  translation provider calls were mocked. The running assessment container was not replaced.
- Business-documentation validation and its five tests, import/contract policy checks,
  Prettier and whitespace checks passed. Caddy configuration and PowerShell syntax passed;
  the focused development-launcher suite passed ten tests with one Linux-only test skipped.

Authenticated browser verification remains incomplete: browser MCP tools were unavailable,
and Computer Use stopped because it could not reliably determine the current browser URL.
Mocked and DOM tests do not establish that browser gate. No live model translation,
source/output approval, instruction activation, container replacement or production backfill
was performed.
