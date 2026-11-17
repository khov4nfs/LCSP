# Customer Usage v1

Implemented in Settings → Usage for customer accounts. This is a read-only report
of persisted model invocation receipts, not a wallet-charge ledger.

## Scope and accounting rules

- LCSP selling estimate uses policy `lcsp-usage-1.8-v1`: the selected report's
  known reference subtotal multiplied by exactly 1.8. The full selling estimate
  remains null when the reference estimate is incomplete. Decimal arithmetic
  preserves sub-attodollar precision rather than rounding each invocation.
  The API returns this quote separately as `sellingPrice`; original provider
  costs, persisted receipts and Admin Usage remain unchanged. This is a current
  report quote, not a historical charge or a wallet debit. Future charge
  settlement must persist its pricing version and define currency conversion
  and rounding independently.

- Default to the last 30 inclusive UTC calendar days, with 7/30/90-day shortcuts
  and custom periods capped at 90 days. Provider/model filters match persisted
  values; status filters use the shared model-attempt constants.
- Display invocation counts, known token counts, missing-token counts, daily /
  provider / model breakdowns, and paginated invocation history.
- Do not reconstruct provider totals by summing token buckets. Null means unknown;
  a reported zero remains zero. Integer-string counts are formatted via BigInt.
- Reference costs are historical USD estimates from persisted official-price
  snapshots. Incomplete estimates retain a known subtotal and a null full estimate.
  They are not LCSP charges or provider invoices.
- No wallet, reservation, ledger, telemetry ingestion, backfill, runtime admission
  policy or spending-limit changes are included. Balance remains in Billing,
  accessible through a link in the Usage panel.
- Refresh reads newly persisted receipts. Late reports can change a previously
  viewed interval. Filters are local to the mounted panel and are not saved as
  account preferences. Reload/reopen defaults to 30 days.

## Request and authorization flow

`CustomerUsageSettingsPanel` → `useCustomerUsageQuery` → `customer-usage-client` → shared `apiValidated`
→ `GET /api/billing/usage` → `GET /billing/usage` → `GetCustomerUsageHandler`
→ shared `UsageAnalyticsReader`.

The API requires the customer role. Ownership comes only from the authenticated
RBAC context; the strict customer query schema rejects `userId`, workflow IDs and
other unsupported filters. The mandatory owner is applied to both aggregate SQL
and paginated Prisma reads. Ownerless system receipts are excluded.

The public response omits internal workflow/invocation identifiers, failure
classes, price-version details and evidence metadata. Public receipt IDs support
stable rendering. All reads use the existing result/problem envelopes.

Admin Usage delegates to the same analytics reader and retains its existing
filters, internal projection and breakdowns. Aggregates and details run inside
one repeatable-read transaction; summary counts do not depend on the page.
Pagination sorts by occurrence time descending, then receipt ID descending.

## Verification

### UI and convention follow-up

Customer Usage uses the existing shadcn Select, Table, Card, Field, Alert and
Empty primitives. The reusable FormSelectField molecule binds through RHF
context and Controller. The history container composes a separate receipt-row
molecule. Query hooks manage subscriptions and cancellation; the customer client
owns request validation and role-error mapping. No native select/table controls
or copied shadcn primitives are introduced in the feature.

The five Customer Usage browser flows cover selecting/clearing status filters,
breakdown selection, keyboard selection inside the Vietnamese mobile modal,
pagination and error/empty/session-expiry behavior after this refactor.

Verified locally on 2026-11-18:

- 57 focused web tests passed: customer contracts/BFF/client, Admin Usage, existing
  Settings/Sessions and Billing regression tests.
- 11 focused API tests passed across customer owner/role boundaries, real
  PostgreSQL aggregation/isolation, billing customer controller and module DI.
- 23 Chromium Settings E2E tests passed: Profile, Sessions and five Customer Usage
  flows, including Vietnamese mobile modal, keyboard pagination, validation,
  precision, incomplete estimates, retry, refresh, empty/forbidden states and
  expired-session routing.
- TypeScript project build, import policy, contract-literal policy and business
  documentation checks/tests passed.

Browser E2E uses controlled HTTP fixtures. PostgreSQL integration separately
exercises the production query handlers with customer A, customer B and ownerless
receipts. These checks do not constitute a production-load benchmark or a live
provider telemetry acceptance test.

Playwright MCP and Chrome DevTools MCP were unavailable in this session.
Verification used Playwright CLI with installed Chromium, browser assertions,
page-error collection and desktop/mobile screenshots. Google Fonts fell back
to local fonts in the network-restricted development server.

## Query-plan observation

On an isolated PostgreSQL 17 database, 20,000 synthetic receipts distributed
across 100 customers were inserted and rolled back after `EXPLAIN (ANALYZE,
BUFFERS)`. The 30-day predicate for one customer matched 68 receipts:

- Count/token-sum probe: 0.334 ms execution time.
- Ordered first-page probe: 0.276 ms, top-N heapsort with 36 KB memory.
- Both used a bitmap combination of `LlmUsageEvent_userId_createdAt_idx` and
  `LlmUsageEvent_occurredAt_idx`.

No index migration was added. These are local core-predicate/page probes, not
full-report production latency guarantees. Profile actual receipt volumes and
deep-page behavior before deciding on `(userId, occurredAt, id)` or cursor
pagination.

## Follow-up boundaries

Spending limits require a separately approved budget definition, concurrency-safe
admission/reservation enforcement, and cancellation/retry policy. Customer Usage
does not imply those controls exist. Exports, realtime updates, workspace-wide
reporting and historical receipt repair are separate scope.
