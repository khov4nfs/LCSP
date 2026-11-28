---
status: approved
project: LCSP
date: 2026-11-24
approved_on: 2026-11-24
approved_by: user
workflow: bmad-correct-course
review_mode: incremental
change_scope: major
trigger:
  - ASM-24
  - Prompt 8 implementation-readiness review
supporting_evidence:
  - docs/planning-artifacts/implementation-readiness-report-2026-11-24.md
  - docs/architecture/assessment-module-audit-red-test-handoff.md
  - docs/architecture/assessment-antigravity-work-package-prompts.md
  - docs/architecture/assessment-shared-wallet-implementation-blockers.md
---

# Sprint Change Proposal: Shared Wallet and Governed Model Usage

## 1. Issue Summary

### Trigger

Assessment finding `ASM-24` and the Prompt 8 implementation-readiness review identified that LCSP requires shared-wallet, direct-credit settlement per physical model invocation, but the capability exists only in Assessment audit and architecture handoff documents. It is absent from canonical product requirements, implementation epics/stories, and approved UX authority.

The same review also found stale organization and Developer-collaboration assumptions in historical planning artifacts. The approved product direction is RBAC-only, with no organization model and no active Developer invitation/task workspace.

### Problem statement

LCSP cannot safely begin production wallet debit implementation because:

1. No canonical FR/NFR authorizes or specifies Prompt 8.
2. No epic/story owns pricing, admission, settlement, migration, reconciliation, compensation, or customer/admin UX.
3. No approved Prompt 8 UX defines financial states and recovery journeys.
4. Existing epics place RBAC, audit, and contract foundations after their consumers.
5. Seven production enablement gates remain open.
6. Existing historical artifacts still assume organization scope and active Developer collaboration.

Contract RED tests may proceed after the corrected requirements are accepted. Production financial writes and debit enablement remain blocked until the applicable prerequisites and all enablement gates have objective evidence.

### Supporting evidence

- The readiness assessment found 31 of 37 PRD narrative requirements materially covered and six absent or contradictory.
- Prompt 8 has zero canonical FRs and zero implementation stories in the evaluated backlog.
- The existing UX review contains no shared-wallet, top-up, charge-history, Admin Model Pricing, reconciliation, or compensation flow.
- Current production behavior credits confirmed payments but does not perform authoritative actual-usage wallet debit.
- Current pricing and usage structures do not prove immutable per-invocation price binding or safe financial settlement.

## 2. Impact Analysis

### Epic impact

- Epic 1 must be reordered so shared contracts, RBAC, and audit foundations precede their consumers.
- Organization membership and Developer invitation/task stories must be removed from active scope.
- Epic 2 must use owner-scoped assessment authorization and support the canonical Wizard-optional technical-evidence path.
- A new Epic 3 must own shared wallet, pricing, admission, settlement, customer billing UX, reconciliation, compensation, and debit enablement.
- Existing Epics 3-8 move to Epics 4-9.
- Every later epic that can call an LLM provider must consume the Epic 3 billing-admission boundary instead of implementing billing locally.
- Reconciliation becomes the single authoritative owner of material conflict aggregates.
- Generic model budget wording must be separated into runtime safety, wallet admission, and actual-usage settlement authorities.

### Artifact conflicts

| Artifact                    | Conflict                                                                          | Required correction                                               |
| --------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| PRD                         | No Prompt 8 requirements; organization wording remains                            | Add canonical billing scope and remove organization authority     |
| Functional requirements     | Canonical range ends at FR-056; FR-007/008 still active organization requirements | Retire organization FRs; add FR-083..FR-094                       |
| Non-functional requirements | Organization-scoped authorization and arbitrary monthly/token caps                | Adopt owner/resource scope and telemetry-first runtime control    |
| Architecture                | Billing authority is not a canonical component                                    | Add ADR-028 and formal component/transaction boundaries           |
| Domain/state/event specs    | No wallet/pricing/admission/settlement state model                                | Add versioned domain objects, states, commands, and events        |
| UX                          | No customer wallet or Admin Model Pricing journey                                 | Add Prompt 8 UX authority and browser acceptance flows            |
| Epics                       | No Prompt 8 epic; forward dependencies and stale stories                          | Reorder Epic 1, add Epic 3, renumber later epics                  |
| Test strategy               | No RED/GREEN trace for financial invariants                                       | Add contract, migration, concurrency, recovery, and browser tests |
| Operations                  | No cutover, reconciliation, compensation, or rollback authority                   | Add runbooks and enablement checklist                             |

### Technical impact

The eventual implementation will affect:

- `packages/contracts` financial constants and schemas.
- NestJS billing, payment, assessment runtime, admin pricing, audit, and outbox boundaries.
- Prisma schema, database constraints, and mixed-unit migration tooling.
- Deepagents/provider-call admission and usage-receipt integration.
- Web customer wallet, top-up, charge history, Continue, Admin Pricing, and reconciliation surfaces.
- CI, observability, reconciliation operations, and rollback procedures.

No production code change is authorized by this proposal alone.

## 3. Recommended Approach

### Selected path: Hybrid direct adjustment plus MVP review

Do not roll back all existing billing, telemetry, pricing, or runtime-control work. Preserve useful components, correct planning authority, and deliver the capability through gated phases.

### Phased path

1. **Authority correction:** PRD, FR/NFR, ADR, UX, epics, stories, and traceability.
2. **Contract RED:** prove missing behavior with focused failing tests; do not invent tariff values.
3. **Shadow accounting and pricing:** microcredit compatibility migration, pricing drafts/snapshots/assignments, and canonical calculator; debit remains off.
4. **Mandatory admission with debit off:** inventory and migrate every provider-call path; prohibit unrestricted fallback.
5. **Shadow settlement:** calculate but do not authoritatively debit; reconcile provider receipts and wallet projections.
6. **Customer/Admin UX:** wallet, top-up, charge history, Continue, pricing, reconciliation, and compensation.
7. **Production enablement:** only after seven gates, GREEN evidence, rollback rehearsal, and operational approval.

### Scope retained in MVP

- Shared prepaid wallet.
- Direct-credit model pricing.
- Per-physical-invocation usage settlement.
- Customer balance, top-up, charge history, payment-required state, and manual Continue.
- Admin Model Pricing.
- Unknown-usage reconciliation and immutable compensation.
- Runtime safety independent from billing.

### Deferred or excluded

- Paid-tool billing.
- Assessment-specific credit allocation.
- Runtime FX/markup conversion.
- Interest or penalties on outstanding usage.
- Automatic assessment resume after top-up.
- Arbitrary lower business token/output caps before an approved telemetry policy.

### Effort and risk

- Planning correction: medium effort, medium risk.
- Production implementation: high effort, high financial-integrity risk.
- Shadow rollout: higher delivery duration but materially lower customer-charge risk.
- Scope classification: **MAJOR**, requiring Product Manager, Architect, Test Architect, Security, Development, QA, and Operations coordination.

## 4. Detailed Change Proposals

### 4.1 PRD and canonical requirements

#### Authorization scope

**Old**

```text
subject + organization + resource + action + runtime context + policy version
```

**New**

```text
authenticated subject + customer-account/owner scope + resource
+ action + runtime context + policy version
```

- Customer resources are scoped by authenticated ownership, including `assessment.ownerId` and `wallet.userId`.
- ADMIN access requires explicit RBAC permission for the action and resource.
- `FR-007` and `FR-008` become `RETIRED_FROM_ACTIVE_MVP`.
- `FR-009` remains active for subject attributes and policy templates without organization dependency.
- `NFR-008..NFR-010` replace organization/delegation wording with owner/resource/service-principal scope.

#### Canonical FR governance

**Old**

```text
Canonical IDs are FR-001..FR-056.
FR-057..FR-082 are historical aliases only.
```

**New**

```text
Canonical IDs are FR-001..FR-056 and FR-083..FR-094.
FR-057..FR-082 remain historical aliases and are not reused.
```

#### New functional requirements

| ID     | Requirement                                                                                                                      |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| FR-083 | Provide one shared prepaid wallet per customer with separate spendable and outstanding projections.                              |
| FR-084 | Credit confirmed payment service value exactly once without creating runtime allowance.                                          |
| FR-085 | Manage mutable pricing drafts and publish immutable, audited pricing snapshots/assignments.                                      |
| FR-086 | Resolve pricing exact model, then provider default, then optional global default for allowlisted models only.                    |
| FR-087 | Use one integer-microcredit calculator for preview and settlement; missing rate buckets fail closed.                             |
| FR-088 | Require server-issued admission before each paid physical provider invocation.                                                   |
| FR-089 | Settle actual provider usage atomically and idempotently by invocation identity.                                                 |
| FR-090 | Block new paid calls when spendable balance is not positive; top-up clears outstanding usage first and requires manual Continue. |
| FR-091 | Show customer charge history by logical operation and physical invocation.                                                       |
| FR-092 | Reconcile unknown usage and late receipts without silently treating missing usage as zero.                                       |
| FR-093 | Correct charges through immutable compensation entries without mutating original debits.                                         |
| FR-094 | Keep wallet/payment authority independent from runtime safety overrides; paid-tool billing remains deferred.                     |

#### New non-functional requirements

| ID      | Requirement                                                                                                                         |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| NFR-036 | Use integer microcredits/BigInt and canonical decimal-string wire formats without floating-point authority.                         |
| NFR-037 | Make payment credit, admission, settlement, reconciliation, and compensation idempotent and transactionally safe.                   |
| NFR-038 | Derive financial authority from server admission; reject callback mass assignment and foreign ownership.                            |
| NFR-039 | Require shadow columns, unit versioning, writer fencing, dual-write, backfill, reconciliation, cutover, and rollback for migration. |
| NFR-040 | Require admission on every enabled sync/async/retry/fallback/preparation provider-call path.                                        |
| NFR-041 | Record safe pricing/usage/correlation telemetry without raw prompts, outputs, or secrets.                                           |
| NFR-042 | Enable production debit only after all enablement gates have GREEN, rollback, and operational evidence.                             |

#### Runtime-control NFR correction

Replace arbitrary monthly/token-cap authority with telemetry-first control:

```text
Every LLM invocation records provider, requested/resolved model,
token buckets, applied provider/runtime limits, finish reason,
operation outcome, and correlation metadata.

No arbitrary lower business token/output cap is introduced until
an approved telemetry-based policy exists. Wallet admission and
applicable runtime safety controls remain independent; no-progress does not block assessment continuation.
```

### 4.2 Pricing cost model and tax boundary

Initial Admin Pricing Draft assumptions:

```text
FX reference:             26,500 VND/USD
Infrastructure overhead:  10% of converted provider cost
Markup multiplier:        1.8 on fully loaded estimated cost
Monthly infrastructure:   500,000 VND validation baseline
```

These are versioned, editable draft assumptions, not runtime constants and not approved universal tariffs.

```text
provider cost in VND
+ provider/payment-related fees
+ infrastructure estimate
+ risk buffer
= estimated loaded cost

estimated loaded cost × approved markup
= suggested customer service tariff
```

Tax boundary:

- Customer transaction tax is calculated at Billing Order/Checkout/Invoice, not per model invocation.
- One credit corresponds to one VND of confirmed service value before customer transaction tax.
- Payment records separate `serviceValue`, `taxAmount`, `paymentTotal`, and `creditedMicrocredits`.
- Tax does not become spendable wallet credit.
- Provider-related taxes/fees may be cost-model inputs when approved.
- No tax rate is hardcoded without approved finance/accounting policy.

Cost sources distinguish provider-local pricing, provider invoice, bank/payment-processor settlement, enterprise contract, and market reference. Actual profitability uses invoice/settlement data rather than assuming market FX equals realized FX.

### 4.3 Architecture authority

Create:

```text
docs/architecture/adr/adr-028-shared-wallet-model-usage-settlement.md
```

ADR-028 is accepted for contract design and phased implementation. Production debit enablement remains separately gated.

Canonical flow:

```text
Payment confirmation
-> Shared wallet credit
-> Server-issued invocation admission
-> Provider call
-> Provider usage receipt
-> Canonical pricing calculator
-> Atomic ledger settlement
-> Wallet projection + billing outbox
-> Runtime checkpoint / customer Continue
```

NestJS owns financial authority. Python/deepagents may request admission and submit usage evidence but may not choose wallet identity, pricing authority, or charge amount.

Add domain objects:

- `CreditWallet`
- `WalletLedgerEntry`
- `WalletProjection`
- `ProviderCostSnapshot`
- `ModelPricingDraft`
- `ModelPricingSnapshot`
- `ModelPricingAssignment`
- `BillableInvocationAdmission`
- `LlmUsageReceipt`
- `BillingReconciliationCase`
- `BillingCompensation`

Add pricing, invocation, payment-required, reconciliation, and compensation state machines. Add versioned billing commands/events and canonical transaction boundaries for credit, admission, settlement, and compensation.

### 4.4 UX authority

Create:

```text
docs/planning-artifacts/assessment-shared-wallet-pricing-ux.md
```

Update the canonical UX review to reference the new Prompt 8 UX.

Customer surfaces:

- Wallet summary with spendable and outstanding values.
- Top-up checkout with service value, tax, total, and credited amount.
- Payment-required state.
- Manual Continue after top-up.
- Applicable runtime failure states and customer recovery actions; no no-progress blocker or Admin unlock.
- Charge history by logical operation and physical invocation.
- Safe unknown-usage/reconciliation state.

Admin surfaces:

- Exact/provider/global pricing list.
- Pricing draft cost model.
- Suggested tariff and projected-margin preview.
- Immutable publish confirmation and history.
- Reconciliation queue and billing-integrity review.
- Bounded immutable compensation flow.

All customer copy uses i18n, supports Vietnamese, provides accessible status announcements, and avoids exposing internal margin assumptions.

### 4.5 Epic and story changes

Reorder Epic 1 so contracts, RBAC, and audit precede auth/business consumers. Remove organization membership and Developer invitation/task stories.

Keep Epic 2 for owner-scoped assessment and Wizard readiness. Preserve a technical-evidence-only path where missing Wizard declarations remain `UNKNOWN`.

Insert new Epic 3: **Shared Wallet and Governed Model Usage**, with stories:

1. Shared wallet and idempotent top-up.
2. Microcredit compatibility migration.
3. Pricing cost model and canonical calculator.
4. Immutable pricing publication and assignment.
5. Server-issued invocation admission.
6. Mandatory admission on every provider path.
7. Shadow settlement and reconciliation.
8. Atomic actual-usage settlement.
9. Payment Required, top-up, and manual Continue.
10. Customer wallet and charge-history UX.
11. Unknown usage and late-receipt reconciliation.
12. Immutable compensation.
13. Production debit enablement gate.

Renumber existing Epics 3-8 to Epics 4-9 and update their dependencies. Every provider-assisted workload consumes billing admission. Deterministic non-provider work is not model-usage billing. Paid-tool billing remains deferred.

### 4.6 Testing, CI, and observability

Write focused RED tests before production changes for:

- Microcredit parsing/formatting and arithmetic.
- Pricing resolution and missing buckets.
- Payment idempotency and tax separation.
- Immutable publication and interval overlap.
- Admission ownership, pricing, exposure, and slot behavior.
- Settlement idempotency, concurrency, and atomicity.
- Signed wallet projections and negative balances.
- Payment-required and manual Continue behavior.
- Unknown usage, late receipts, and terminal precedence.
- Compensation bounds and audit/outbox atomicity.
- Deepagents provider-call admission coverage.
- Customer/Admin browser journeys.

Observability includes admission decisions, bypass attempts, settlement conflicts, unknown usage, late receipts, fallback pricing, negative balances, projection mismatch, compensation, and shadow-settlement variance. No metric/log carries raw prompts, outputs, or secrets.

## 5. Implementation Handoff

### Scope classification

**MAJOR:** fundamental replan requiring Product Manager and Architect ownership before Developer implementation.

### Responsibilities

| Role                    | Responsibility                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Product Manager / Owner | Approve FR/NFR, MVP scope, tax/credit semantics, and initial pricing assumptions                                  |
| Architect               | Author ADR-028, domain/state/event boundaries, transactions, and no-organization alignment                        |
| UX Designer             | Produce customer wallet and Admin Pricing UX, Vietnamese copy, and accessibility states                           |
| Test Architect          | Produce traceability and RED tests; verify meaningful RED behavior                                                |
| Developer               | Implement one approved story at a time after RED; keep debit off until enablement                                 |
| Security Reviewer       | Review ownership/BOLA, mass assignment, replay, pricing mutation, negative-balance bypass, and compensation abuse |
| Independent Reviewer    | Verify every provider-call path, migration evidence, and rollback behavior                                        |
| QA / Operations         | Run scoped/browser regression, shadow reconciliation, cutover rehearsal, and operational readiness checks         |

### Success criteria

1. Canonical product requirements use stable IDs and contain no organization/PBAC/active Developer dependency.
2. ADR-028 and domain/state/event contracts are approved.
3. Prompt 8 UX is approved and traceable to stories.
4. Every story has AC IDs, RED tests, implementation evidence, independent review, and QA receipt.
5. Migration and rollback are rehearsed with per-wallet reconciliation evidence.
6. Every provider-call path requires valid admission before debit enablement.
7. Shadow settlement variance and unknown usage are operationally controlled.
8. All seven enablement gates have GREEN and rollback evidence.
9. Debit is enabled only through a separately approved operational decision.

### Seven production enablement gates

1. Owner-approved initial ACTIVE tariff coverage.
2. Admission-to-settlement authority binding.
3. Mixed-version microcredit migration and cutover.
4. Canonical maximum monetary exposure.
5. Immutable pricing publication and interval authority.
6. Mandatory admission on every provider-call path.
7. Versioned/idempotent reconciliation and compensation.

## 6. Change Navigation Checklist Status

| Section                     | Status   | Notes                                                                   |
| --------------------------- | -------- | ----------------------------------------------------------------------- |
| 1. Trigger and context      | Complete | Approved incrementally by user                                          |
| 2. Epic impact              | Complete | Approved incrementally by user                                          |
| 3. Artifact impact          | Complete | Approved incrementally by user                                          |
| 4. Path forward             | Complete | Hybrid approach approved by user                                        |
| 5. Proposal components      | Complete | PRD, architecture, UX, epics, tests, and handoff approved incrementally |
| 6. Final review and handoff | Complete | Final proposal approved; MAJOR handoff recorded                         |

## 7. Approval and Change-Control Boundary

Incremental proposal sections and the compiled proposal were explicitly approved by the user during the Correct Course workflow on 2026-11-24.

Final approval authorizes planning-artifact correction and the approved RED-test phase. It does not by itself authorize:

- Production debit enablement.
- Inventing provider tariffs without approved cost sources.
- Hardcoding tax rates.
- Paid-tool billing.
- Commit, push, or PR creation.

Update the affected planning artifacts in controlled order. Production implementation remains story- and gate-dependent.

### Sprint-status preservation decision

`docs/implementation-artifacts/sprint-status.yaml` contains existing stories in `done`, `review`, `in-progress`, and `ready-for-dev` states. It is intentionally unchanged during proposal finalization because renumbering it before the approved epic rewrite would destroy traceability between historical execution receipts and the old story IDs.

The backlog-reorganization handoff must:

1. Update `epics.md` first.
2. Produce an explicit old-story-ID to new-story-ID migration table.
3. Preserve completed/review history through aliases or migration metadata.
4. Add the new Epic 3 stories as `backlog`.
5. Update `sprint-status.yaml` only after the migrated epic artifact is validated.

## 8. Handoff Execution Log

### Workflow completion

- **Issue addressed:** Prompt 8 lacks canonical product, architecture, UX, backlog, and financial-enablement authority.
- **Selected approach:** Hybrid direct adjustment plus MVP review with phased shadow rollout.
- **Change scope:** MAJOR.
- **Proposal approval:** Explicit `yes` from the user on 2026-11-24.
- **Artifacts modified by this workflow:** This Sprint Change Proposal only.
- **Artifacts intentionally preserved:** PRD, FR/NFR catalogs, architecture, UX, epics, sprint status, production code, and tests.
- **Routed to:** Product Manager / Product Owner and Solution Architect first; then UX Designer and Test Architect; Developer implementation follows approved RED evidence.

### Required handoff order

1. Product Manager/Owner updates and approves PRD plus `FR-083..FR-094` and `NFR-036..NFR-042`.
2. Architect authors ADR-028 and updates domain/state/event/persistence boundaries.
3. UX Designer produces the Prompt 8 customer/Admin UX specification.
4. Product Manager/Architect reorganize epics and produce the story-ID migration map.
5. Sprint status is migrated without losing historical status evidence.
6. Test Architect creates traceability and focused contract RED tests.
7. Developers implement phased GREEN work with debit disabled.
8. Security, independent review, QA, and Operations validate each gate.

### Completion boundary

The Correct Course workflow is complete. The approved proposal is the handoff authority for planning correction and RED-test preparation. It is not a production debit enablement receipt.
