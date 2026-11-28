---
title: "ADR-028: Shared Wallet and Governed Model-Usage Settlement"
status: Accepted for contract design and phased implementation
date: "2026-11-24"
decision_owners: [Product Owner, Finance Owner, Engineering Owner]
production_readiness: blocked_until_G-01_through_G-07
supersedes: [legacy reservation-first model-usage charging]
---

# ADR-028: Shared Wallet and Governed Model-Usage Settlement

## Context

LCSP already has idempotent prepaid payment credit, one wallet per user, an append-only credit ledger and provider-usage telemetry. The current provider callback is intentionally non-financial: `SettledUsagePayload` contains provider identity/token evidence but no reservation, price or charge authority, and `BillingUsageKernel` explicitly records telemetry without wallet movement.

The existing persistence shape also contains legacy reservation fields, nonnegative wallet projections and reference-cost pricing fields. Those shapes cannot be reinterpreted in place as authoritative direct-credit settlement. Prompt 8 instead requires one shared wallet across assessments, immutable customer tariffs, server admission before each physical provider call, actual-usage settlement after each call, visible outstanding usage and governed reconciliation.

Graphify supplied navigation candidates only. Material conclusions were verified in current source: `packages/contracts/src/billing/prepaid.ts`, `apps/api/src/modules/billing/application/shared/billing-usage.kernel.ts`, `deepagents/tools/common/capabilities/platform/callback_schemas.py`, `deepagents/tools/common/capabilities/platform/api_client.py`, `apps/api/src/modules/billing/domain/repositories/billing-transaction.port.ts` and `apps/api/prisma/schema.prisma`.

## Decision

Adopt a **hexagonal financial authority with server-issued capability admission**.

NestJS Billing is the sole authority for wallet ownership, pricing publication/resolution, admission, ledger mutation, signed projection, reconciliation and compensation. Deepagents owns provider execution and provider-evidence capture, but it cannot choose or override the owner, wallet, tariff, maximum exposure or charged amount. The single `WORKER_API_KEY` authenticates the internal transport only; financial authority comes from an immutable server-issued admission.

### 1. Accounting unit and wallet projection

```text
1 public credit = 1 VND confirmed pre-tax service value
1 public credit = 1,000,000 microcredits
```

Authoritative arithmetic uses integer microcredits/BigInt. Wire values use canonical base-10 decimal strings. Customer transaction tax is recorded at checkout/invoice and never becomes spendable credit.

Each customer owns one shared wallet across assessments. The authoritative balance may be signed:

```text
spendableMicrocredits   = max(ledgerBalanceMicrocredits, 0)
outstandingMicrocredits = max(-ledgerBalanceMicrocredits, 0)
```

No assessment receives a credit allocation or reserved balance. A top-up clears outstanding usage before producing spendable balance.

### 2. Pricing authority

Pricing has three separate forms:

```text
CustomerModelTariffDraft       mutable operational estimate, never billable
CustomerModelTariffSnapshot    immutable published microcredit tariff
CustomerModelTariffAssignment  versioned scope + [effectiveFrom,effectiveTo)
```

The current Prisma `ModelPricingSnapshot` represents legacy provider/reference-cost and FX/markup semantics. It must not be reused or silently migrated into customer tariff authority. New customer tariff entities use distinct names and accounting-unit/version fields.

Resolution order is exact resolved model, provider default, then optional global default. Defaults can price only a canonical `resolvedModelId` already allowed by runtime model policy. Publication and admission share one normalized scope-key function over canonical provider ID/resolved model ID; free-form aliases are input/display only. Admission obtains one database timestamp inside the transaction that selects the effective assignment and creates admission. The persisted timestamp and assignment ID make boundary-time resolution replayable. Database constraints use the same normalized key, database UTC and half-open interval.

The Pricing Draft may use approved provider cost, FX reference, provider/payment fees, infrastructure estimate, risk buffer and markup. Runtime admission/settlement uses only the published microcredit tariff. It never fetches FX, reapplies markup or calculates tax.

Published rates are nonnegative integer microcredits per token. Charge calculation uses checked integer arithmetic and exactly:

```text
Σ(normalized non-overlapping bucket token count × pinned bucket rate)
```

There is no per-bucket or final floating-point rounding. A nonzero normalized bucket without a pinned rate fails closed into integrity review. A tariff becomes resolvable only when immutable snapshot, effective assignment, audit and outbox publish atomically; partial draft/snapshot state is never ACTIVE.

### 3. Physical invocation and admission identity

Every physical provider dispatch has a unique `invocationId`. Retry or fallback creates a new physical invocation while retaining the same `logicalOperationId`.

Before dispatch, NestJS issues an immutable `BillableInvocationAdmission`. Every admission has one funding principal:

- `CUSTOMER_WALLET`: binds an owner/wallet and may debit only that wallet;
- `PLATFORM_SPONSORED`: requires explicit server-side sponsorship permission and pins an immutable `PlatformSponsorshipPolicySnapshot` containing provider-cost/exposure authority. It never resolves a customer tariff or writes a customer ledger debit.

System-owned preparation work with no customer owner must use `PLATFORM_SPONSORED`. An ownerless call without approved sponsorship fails before dispatch; it never bypasses admission and is never assigned to an arbitrary customer.

Admission is bound to:

- funding principal: either customer owner/wallet or immutable platform sponsorship policy;
- assessment, run and execution lease;
- logical operation and physical invocation;
- requested and resolved model/provider;
- immutable pricing snapshot and resolution reason;
- runtime policy version;
- versioned maximum monetary exposure;
- correlation/idempotency identity and expiry/consumption state.

The request uses a stable caller-generated `admissionRequestId` plus canonical fingerprint scoped to run, logical operation and planned attempt ordinal. A lost-response retry returns the same server `invocationId` and admission; a changed fingerprint conflicts. Retry/fallback that represents a new physical provider attempt uses a new request ID and invocation.

Issuance returns a high-entropy single-admission capability secret. PostgreSQL stores only its digest plus job/run/lease/invocation binding. The capability is not one-use at the transport level: after the idempotent consume CAS, it remains valid only for evidence delivery/recovery of that same immutable admission until terminal acknowledgement. The worker may retain it only as an encrypted recovery envelope in its durable journal, protected by a worker-local encryption key and restrictive filesystem permissions; it is never logged, stored in plaintext or copied into telemetry, and is deleted after terminal acknowledgement. Consume and settlement verify the capability, expected state and immutable binding in addition to `WORKER_API_KEY`, so a restarted worker can deliver the original evidence without a second provider dispatch. Replay safety comes from admission state plus canonical fingerprints, not from discarding the recovery proof after consume. A future signed capability must equivalently validate issuer, audience, expiry, nonce and key version and may not carry client-overridable monetary authority.

NestJS/PostgreSQL owns the authoritative compare-and-set to `IN_FLIGHT`. That transition commits before the worker may send the first provider byte. A crash after `IN_FLIGHT` but before dispatch proof becomes `DISPATCH_UNKNOWN`, retains bounded exposure and follows reconciliation; transport retry never reuses the same physical invocation or automatically repeats the provider call. Expiry may reject an unconsumed admission but never silently closes `IN_FLIGHT`, `DISPATCH_UNKNOWN` or `OUTCOME_UNKNOWN`.

Runtime safety permission and wallet admission are independent prerequisites. Payment cannot grant retry/token allowance, and Admin runtime override cannot add credits. No-progress is not an admission or resume blocker.

### 4. Versioned worker contracts

Keep the current telemetry callback non-financial during migration. Add separate versioned contracts:

- admission request/response;
- admission consumption/dispatch acknowledgement;
- provider usage receipt;
- output evaluation;
- reconciliation evidence where applicable.

Worker messages carry admission identity and provider evidence only. They never carry an authoritative wallet ID, rate, computed charge or actor authority supplied by the client. NestJS resolves all financial identity from admission.

`packages/contracts` owns the financial contract family: strict version/discriminator, SCREAMING_SNAKE_CASE value sets, canonical identity/fingerprint helpers and cross-runtime test vectors. Compatibility is expand-only. Unsupported versions fail before mutation, and no compatibility mapper may invent admission, tariff, owner/wallet or charge authority.

The provider receipt is normalized through a versioned provider/model mapping into non-overlapping billable buckets:

- uncached input;
- cached-input read;
- cache write 5-minute;
- cache write 1-hour;
- visible output;
- reasoning output.

Provider-inclusive fields such as `inputTokensIncludingCache`, aggregate `inputTokens` where semantics are ambiguous, and `totalTokens` remain evidence only; they are never added as extra billable buckets. The mapping version and raw safe provider field presence are persisted. Overlap, unknown mapping, invalid negative values or missing required evidence fails closed into `BILLING_INTEGRITY_REVIEW`; the system never reconstructs or double-prices tokens.

### 5. Atomic settlement

For confirmed usage, one PostgreSQL transaction under the wallet/admission concurrency boundary commits:

- immutable provider usage receipt;
- `MODEL_USAGE_DEBIT` ledger entry;
- signed microcredit wallet projection/version;
- terminal admission/in-flight state;
- financial audit event;
- transactional billing outbox event.

That customer-funded branch writes `MODEL_USAGE_DEBIT` and the customer projection. The `PLATFORM_SPONSORED` branch persists the same normalized provider receipt, sponsorship exposure/cost record, audit and operations outbox, but writes no customer ledger entry, outstanding balance or customer payment-required event.

To prevent cross-command deadlocks, financial mutations acquire authoritative locks in this order: wallet or platform-sponsorship aggregate, admission, original debit/reconciliation case, then projection/outbox writes. Implementations may optimize the mechanism but cannot reverse this logical order.

Settlement is idempotent by a versioned canonical fingerprint over admission ID/version, invocation ID, provider response identity, normalized usage receipt, mapping version and terminal outcome. The shared helper/test vectors define field order and serialization; correlation ID and delivery timestamp are excluded. Exact replay returns the existing result. A conflicting replay fails closed. Provider usage beyond the admitted maximum exposure does not silently expand debt; it enters `BILLING_INTEGRITY_REVIEW`.

An admitted in-flight call may settle into outstanding balance because the exposure was bounded before dispatch. A non-positive spendable balance blocks only new paid dispatches; it does not block login, read-only access or existing artifact download.

The append-only microcredit ledger is accounting authority. The signed wallet balance/version is a transactionally maintained projection. Any mismatch blocks further financial writes, emits an integrity alert and is reconciled from the ledger; the system never silently chooses the larger/smaller value. The existing nonnegative `BillingAccountingKernel` debit path cannot be reused unchanged for signed-microcredit settlement.

### 6. Attempt outcome and output evaluation

Billing outcome and domain-output quality are separate records:

- provider usage receipt owns reported token buckets, provider finish reason and usage availability;
- output evaluation owns `ACCEPTED`, `SCHEMA_INVALID`, `DOMAIN_REJECTED` or `NOT_EVALUATED`.

Confirmed provider usage remains billable when output is truncated, schema-invalid or domain-rejected. Missing terminal usage becomes `OUTCOME_UNKNOWN`, not zero.

### 7. Reconciliation and compensation

`DISPATCH_UNKNOWN` and `OUTCOME_UNKNOWN` retain bounded exposure and route to a versioned reconciliation case. A late provider receipt settles the original invocation; LCSP does not replay that provider invocation. A durable, admission-bound no-usage proof may close it as `CONFIRMED_NO_USAGE`.

Terminal precedence prevents an unaudited late callback from rewriting a reviewed no-usage outcome. Late conflicting evidence is appended to `BILLING_INTEGRITY_REVIEW`; it cannot debit until an explicit versioned audited reopen. The original no-usage decision remains immutable history.

Compensation is a new immutable ledger entry linked to the original debit. It is idempotent, server-calculated and bounded by the debit's remaining uncompensated amount. The command locks/versions the original debit compensation aggregate and atomically rechecks cumulative compensation before appending ledger/projection/audit/outbox, so concurrent requests cannot exceed the debit. Goodwill credit is a separate action.

### 8. Payment-required and Continue

When spendable balance is not positive, new paid admissions fail with `PAYMENT_REQUIRED`. The affected assessment checkpoints when it next requires paid work; the system does not mass-update unrelated assessments.

Top-up emits wallet/payment events but never resumes work. Customer Continue causes the runtime to re-evaluate wallet, pricing, run/lease and applicable safety gates; it does not wait for a no-progress override.

### 9. Authorization and audit

Authorization is RBAC-only and owner/resource-scoped:

- customer wallet/charge queries bind `wallet.userId` to the authenticated subject;
- assessment references bind `assessment.ownerId`;
- pricing, reconciliation and compensation require explicit Admin action permission;
- a role label or shared worker key alone never grants financial authority;
- no PBAC or organization dimension is introduced.

Shared contract actions are distinct for pricing draft, pricing publish/supersede, platform sponsorship, reconciliation decision, compensation and goodwill credit. Every mutation resolves command resource IDs back to database-owned wallet/admission/debit relationships before authorization and write.

Audit records derive actor/time server-side and include safe owner/resource refs, action, decision, policy/version, pricing/admission identity and correlation ID. They exclude raw prompts, outputs, secrets and internal credentials.

## Persistence ownership

PostgreSQL is authoritative. Prisma models are expand-only during rollout:

- add clearly unit-named microcredit columns and an accounting-unit version rather than rescaling legacy `*Credits` columns;
- add distinctly named immutable customer-tariff draft/snapshot/assignment, admission, usage receipt, reconciliation, compensation and outbox state needed by this ADR;
- retain legacy reservation rows only for compatibility drain/release; new Prompt 8 flow creates no credit reservation;
- use database constraints for idempotency, immutable identity and non-overlapping pricing intervals;
- preserve one authoritative writer per entity through NestJS Billing ports.

During compatibility migration, the NestJS Billing transaction derives legacy credits and new microcredits from the same immutable payment/ledger input and records the accounting-unit version. Backfill is idempotent, every wallet must reconcile exactly, and old writers are fenced/drained before cutover. A mismatch blocks cutover and financial mutation. After cutover, the microcredit ledger is the only accounting authority; shadow columns cannot remain a competing writer/source.

The deepagents SQLite `RunAdmission` journal may preserve local runtime safety continuity, but it is not `BillableInvocationAdmission`, the customer wallet or financial ledger authority. Naming and adapters must keep these concepts distinct; only the NestJS/PostgreSQL CAS owns customer-financial `ADMITTED → IN_FLIGHT`.

## Delivery and cutover

The mandatory order is:

1. Contract RED tests and provider-call inventory.
2. Shadow microcredit compatibility, pricing drafts/snapshots/assignments and canonical calculator; debit off.
3. Mandatory admission on every enabled provider-call path; debit off.
4. Shadow settlement/reconciliation against provider receipts and wallet projections; debit off.
5. Customer/Admin UX plus migration, rollback and operations rehearsal.
6. Production debit only when `G-01..G-07` in `docs/product/addendum.md` are GREEN with named approvals/evidence.

Rollout is one server-authoritative monotonic mode, not independent booleans:

```text
TELEMETRY_ONLY
→ SHADOW_PRICING
→ ADMISSION_REQUIRED
→ SHADOW_SETTLEMENT
→ DEBIT_ENABLED
```

Mode transition records gate-evidence/version and is monotonic except an audited emergency rollback to a safer earlier mode. Admission pins rollout mode/version. Settlement may debit only an admission issued under eligible `DEBIT_ENABLED` authority; a later process observing a newer mode cannot upgrade an older shadow admission. Unknown/skewed mode fails closed.

Emergency rollback stops new admissions and revokes unconsumed customer-funded `ADMITTED` capabilities. Existing `IN_FLIGHT` work is never re-dispatched: it either settles under its pinned debit authority when the rollback does not invalidate financial integrity, or—when the rollback declares a financial-integrity freeze—records evidence in `BILLING_INTEGRITY_REVIEW` without debit until an audited decision. The rollback record must declare which branch applies and cannot silently change a settled result.

Admission timeout/unavailability blocks every new provider dispatch. No cached/offline/local admission may replace server authority. Already `IN_FLIGHT` work may deliver or recover evidence through the durable recovery path without a second provider dispatch.

Financial outbox events include immutable event ID, aggregate ID/version, event type/version, assessment/run/lease, invocation and correlation identity. Consumers are at-least-once idempotent by event ID/version, re-check the current run boundary and never checkpoint unrelated assessments sharing a wallet. Stale events cannot regress a newer state.

## Consequences

### Positive

- Charges are deterministic and replayable across model/provider/tariff changes.
- Worker compromise or callback mass assignment cannot select financial authority.
- Shared-wallet behavior remains simple for customers while each physical retry/fallback stays explainable.
- Unknown usage, negative balance and corrections have explicit auditable states.
- Existing telemetry can continue during an expand-only migration.

### Costs and trade-offs

- Admission adds a synchronous control-plane dependency before provider dispatch.
- Financial persistence and migration require concurrency, replay and rollback evidence before debit can be enabled.
- Unknown provider outcomes may temporarily consume exposure and require operations review.
- Pricing publication and provider-call coverage become operational responsibilities, not static configuration.

## Rejected alternatives

- Per-assessment allocation/reservation: rejected because the product uses one shared wallet and charges actual usage.
- Runtime provider cost × FX × markup: rejected because historical charges would drift and cost accounting would become customer tariff authority.
- Client/worker supplied rate or amount: rejected as mass-assignment and replay risk.
- Missing usage equals zero: rejected because absence of metadata is not evidence of no provider cost.
- Automatic resume after top-up: rejected because payment must not bypass runtime state/safety checks.
- One fixed concurrency slot as business policy: rejected until `G-04` approves evidence-based exposure/concurrency values; no per-assessment execution limit is introduced.
- Paid-tool billing: deferred to a separate decision.

## Verification obligations

- Contract tests for strict schemas, decimal strings, canonical constants and no monetary authority in worker evidence.
- Property tests for microcredit calculation and preview/settlement equivalence.
- BOLA, RBAC and callback mass-assignment tests.
- Database concurrency tests for idempotent credit/debit, no-overlap pricing and compensation bounds.
- Provider-path inventory proving admission on sync/async/retry/fallback/preparation calls.
- Worker capability-envelope encryption-key startup, rotation, loss recovery and terminal-deletion runbook tests; `G-06/G-07` cannot be GREEN without this evidence.
- Migration dual-view reconciliation and rollback rehearsal.
- Late receipt, `OUTCOME_UNKNOWN`, terminal-precedence and outbox/DLQ tests.
- Shadow-to-authoritative variance and operational gate evidence for `G-01..G-07`.

## Deferred

- Initial ACTIVE tariff values and cost-source approvals (`G-01`).
- Numeric maximum exposure and concurrency policy (`G-04`).
- Exact database/table/index layout beyond the invariants above; implementation spec and Prisma migrations own the final shape.
- Paid-tool tariff units, receipt identity and refund semantics.
