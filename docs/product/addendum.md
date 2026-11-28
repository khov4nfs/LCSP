# LCSP PRD Addendum

## Purpose

Preserve approved Prompt 8 detail that informs architecture, UX, pricing operations and test design but does not belong in the product-requirement spine.

## Prompt 8 Pricing Assumptions

The initial Admin Pricing Draft uses these editable, versioned assumptions:

```text
FX reference:             26,500 VND/USD
Infrastructure overhead:  10% of converted provider cost
Markup multiplier:        1.2 on estimated loaded cost
Monthly infrastructure:   500,000 VND validation baseline
```

These values are not hardcoded runtime constants, approved universal provider tariffs or evidence of realized profitability. Each provider/model/token bucket still requires verified cost sources and an approved immutable customer tariff before production debit can use it.

The `1.2` markup on an approved loaded-cost base corresponds mathematically to a projected gross margin of approximately `16.67%` before customer/provider tax treatment and any costs that the approved loaded-cost inputs explicitly exclude.

For planning, `loaded cost` means:

```text
provider cost converted to VND
+ approved provider/payment-related fees
+ infrastructure estimate
+ approved risk buffer
= estimated loaded cost

estimated loaded cost × approved markup
= suggested customer service tariff
```

The current `10%` infrastructure assumption is defined. Provider/payment-related fees and the risk buffer still require versioned values and evidence before a suggested tariff can be approved. The `16.67%` figure is therefore only the mathematical gross margin implied by a `1.2` multiplier on whatever loaded-cost inputs were approved; it is not realized profit.

## Cost Source and FX Separation

Pricing operations distinguish:

- provider local-currency catalog price;
- provider invoice or billing export;
- bank/payment-processor settlement;
- enterprise-contract or marketplace price;
- market FX used only as an approved planning reference.

Estimated pricing may use a versioned reference source. Realized profitability compares customer revenue with actual provider invoice/settlement and infrastructure data. Runtime invocation settlement never fetches FX or provider pricing; it uses the immutable customer tariff pinned by server admission.

## Tax Boundary

Customer transaction tax is calculated at Billing Order/Checkout/Invoice. Payment records separate:

```text
serviceValue
taxAmount
paymentTotal
creditedMicrocredits
```

One public credit represents one VND of confirmed pre-tax service value. Tax does not become spendable credit. Provider-related taxes/fees may be approved cost-model inputs. No tax rate is hardcoded without finance/accounting authority.

## Rejected Alternatives

### Runtime `provider cost × FX × markup`

Rejected because replay could produce different customer charges as provider price or FX changes, and runtime settlement would mix cost accounting with customer tariff authority.

### Per-assessment credit allocation or reservation

Rejected for Prompt 8. All assessments owned by one customer use the shared wallet; concurrency/exposure controls do not create assessment-specific balances.

### Automatic resume after top-up

Rejected because payment must not bypass run/lease, pricing or applicable runtime safety checks. Customer explicitly selects Continue; no-progress is not an assessment blocker.

### Missing usage equals zero

Rejected because timeout or incomplete metadata does not prove the provider consumed no billable resources. Unknown usage requires bounded reconciliation.

### Paid-tool billing in Prompt 8

Deferred until tool-specific tariff units, receipt identity and refund semantics receive separate product authority.

## Seven Enablement Gates

Production model-usage debit remains disabled until all gates have approved GREEN, rollback and operational evidence:

| Gate                               | Accountable approval                                | Measurable exit condition                                                                                                                 | Minimum evidence                                                                                                              |
| ---------------------------------- | --------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `G-01` Tariff coverage             | Product Owner + Finance Owner                       | Every enabled billable model/token bucket resolves to an owner-approved ACTIVE tariff; missing coverage fails closed.                     | Coverage report, source evidence, approval record and rollback tariff plan.                                                   |
| `G-02` Authority binding           | Engineering Owner + Security Reviewer               | Admission identity and settlement receipt cannot be rebound to another owner, wallet, run, model or pricing authority.                    | Contract tests, BOLA/mass-assignment tests and threat-model signoff.                                                          |
| `G-03` Accounting-unit cutover     | Data/Engineering Owner + Finance Owner              | Every wallet reconciles exactly between legacy and microcredit views; mixed-unit writes are fenced and rollback rehearsal passes.         | Migration reconciliation report, cutover/rollback rehearsal and exception register.                                           |
| `G-04` Maximum exposure            | Product Owner + Finance Owner + Security Reviewer   | One canonical monetary-exposure rule bounds every admitted physical invocation and over-exposure fails to integrity review.               | Boundary/property tests, policy version and approved exposure rationale.                                                      |
| `G-05` Pricing publication         | Finance Owner + Engineering Owner                   | Published snapshots are immutable, assignments do not overlap per scope, stale publication fails and emergency rollback is rehearsed.     | Concurrency tests, database constraint evidence, audit sample and rollback runbook.                                           |
| `G-06` Provider-call coverage      | Engineering Owner + QA Owner                        | Inventory proves 100% of enabled sync/async/retry/fallback/preparation provider paths require admission; unrestricted fallback is absent. | Static inventory, integration tests, shadow telemetry coverage and worker capability-envelope key startup/rotation evidence.  |
| `G-07` Reconciliation/compensation | Billing Operations Owner + Finance Owner + QA Owner | Unknown usage reaches bounded terminal resolution; replay is idempotent; compensation cannot exceed uncompensated debit.                  | Late-receipt/replay/concurrency tests, queue SLO evidence, encrypted recovery/loss-deletion rehearsal and operations runbook. |

Final go/no-go authority belongs jointly to the Product Owner, Finance Owner and Release Authority. Any RED or missing evidence keeps production debit disabled.

## Required Delivery Sequence

1. Authority correction in PRD, FR/NFR, ADR, UX, epics, stories and traceability.
2. Contract RED tests for missing behavior without invented tariff values.
3. Shadow accounting and pricing with authoritative debit disabled.
4. Mandatory admission across provider-call paths while debit remains disabled.
5. Shadow settlement and reconciliation against provider receipts; debit remains disabled.
6. Customer/Admin UX and operational rehearsal.
7. Production enablement only after `G-01..G-07` are GREEN.

## Prompt 8 UX Authority

Customer UX must include wallet spendable/outstanding summary, checkout breakdown (`serviceValue`, `taxAmount`, `paymentTotal`, `creditedMicrocredits`), payment status, `PAYMENT_REQUIRED`, manual Continue, applicable runtime failure states, charge history by logical operation/physical invocation and a safe unknown-usage state. No-progress does not pause the assessment or require Admin approval.

Admin UX must include exact/provider/global pricing coverage, editable cost assumptions with source evidence, suggested tariff/projected-margin preview, immutable publish confirmation/history, reconciliation queue, billing-integrity review and bounded compensation linked to the original debit.

All display copy uses i18n with Vietnamese support, provides accessible status announcements, distinguishes payment blockers from runtime blockers and never exposes internal margin assumptions to Customer users.
