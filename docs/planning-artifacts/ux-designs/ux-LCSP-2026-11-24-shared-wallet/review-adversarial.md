# Adversarial UX / State-Authority Review — LCSP Prompt 8

Reviewed: 2026-11-24  
Scope: updated `DESIGN.md`, `EXPERIENCE.md`, `assessment-shared-wallet-pricing-ux.md`, PRD including `AC-063`, canonical acceptance catalog, ADR-028, Product Addendum and Sprint Change Proposal.

## Overall verdict

**APPROVE.** The updated Prompt 8 UX closes every previously reported authority seam. Customer financial surfaces now consume only authoritative customer-ledger state, Admin shadow data is explicitly non-authoritative, reconciliation cannot invent no-usage, and shared-wallet/version/permission races fail safely without auto-resume or provider redispatch.

No Critical, High or Medium adversarial finding remains. The UX is ready to proceed through the parent validation synthesis/finalization gate; production debit remains separately gated by `G-01..G-07`.

## Re-review matrix

| Attack surface | Result | Evidence |
|---|---|---|
| Shadow pricing/settlement shown as customer money | Closed | Before `DEBIT_ENABLED`, shadow values are Admin-only non-authoritative comparisons; they cannot change Customer balance/history, `PAYMENT_REQUIRED` or Continue (`EXPERIENCE.md:47,146`; companion `:40,160`). |
| Operator invents no-usage from missing receipt/reason | Closed | `CONFIRMED_NO_USAGE` requires server-validated durable no-usage proof bound to the original admission; absence/opinion/reason is insufficient (`EXPERIENCE.md:123`; companion `:188-194`). |
| Stale tab or cross-tab Continue dispatches from old balance | Closed | Latest wallet/assessment versions replace rather than client-merge stale state; fresh rejection dispatches no work and keeps selected context (`EXPERIENCE.md:133-139,164-165`; companion `:114-116`). |
| Wallet event changes unrelated assessments | Closed | Background wallet updates never navigate, resume or checkpoint another assessment; each assessment changes only at its own admission evaluation (`EXPERIENCE.md:135,165`; companion `:116`). |
| Platform-sponsored work appears as customer debit | Closed | Customer totals include only `CUSTOMER_WALLET`; sponsored work is Admin/audit-only or explicitly labeled platform-funded and excluded from wallet totals/recovery (`EXPERIENCE.md:109,149`; companion `:41,146`). |
| Integrity review over-freezes or under-freezes resources | Closed | Server declares affected scope and permitted actions; safe reads remain, top-up is not recovery, and only scoped mutations are disabled (`EXPERIENCE.md:125,139,153`; companion `:202`). |
| Revoked/expired Admin completes stale publish/reconciliation/compensation | Closed | Every Admin submit rechecks session plus action/resource permission; revocation clears protected evidence and never renders success (`EXPERIENCE.md:137-139`; companion `:198`). |
| `DISPATCH_UNKNOWN` omitted or retried | Closed | Both spine and companion expose the distinct state, retain bounded exposure and forbid retry/re-dispatch of the original invocation (`EXPERIENCE.md:48,106,123,136`; companion `:125,186`). |
| FR-094 traceability points only to debit-enablement AC | Closed | New `AC-063` covers payment/runtime separation; UX maps FR-094 to AC-063 and isolates AC-062 on production enablement. Admission and settlement rows now map FR-088/089 to AC-056/057 (`prd.md:1178`; companion `:271-285`; acceptance catalog `:68`). |
| Background wallet notifications spam or steal focus | Closed | Semantic-state deduplication, one atomic status region, passive updates unless next action changes, and no background focus movement are explicit (`EXPERIENCE.md:165,172+`; companion `:215+`). |
| Organization/PBAC/per-assessment allocation/automatic resume/paid-tool billing drift | Closed | RBAC owner/resource scope, one shared wallet, manual Continue and paid-tool exclusion remain explicit throughout (`EXPERIENCE.md:19-23,154,166`; companion `:22,30-41,291+`). |

## Additional concurrency and privacy checks

- Pricing publication still rejects stale draft versions and overlapping normalized intervals while preserving the draft for re-review (`EXPERIENCE.md:83-85,120,137,229`; companion `:176-182`).
- Compensation still derives identity/bounds server-side, refreshes stale versions and preserves the immutable original debit (`EXPERIENCE.md:87-88,126-127,139`; companion `:204-208`).
- Customer and Admin evidence continue to exclude prompts, outputs, secrets, provider credentials and internal Customer-facing margin assumptions (`EXPERIENCE.md:53,145-154`).
- `OUTCOME_UNKNOWN` and `DISPATCH_UNKNOWN` remain non-final, excluded from guessed/final customer charge and routed to bounded reconciliation (`EXPERIENCE.md:106-107,123,148`).
- Payment confirmation remains idempotent and never establishes credit from browser/provider query parameters (`EXPERIENCE.md:79,134,163`).

## Severity summary

- Critical: 0
- High: 0
- Medium: 0
- Low: 0

**Final adversarial gate: APPROVE.**
