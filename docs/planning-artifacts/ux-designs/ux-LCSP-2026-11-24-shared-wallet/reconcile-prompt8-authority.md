# Prompt 8 UX source reconciliation

Updated: 2026-11-24

## Included decisions

| Source decision | UX realization |
|---|---|
| One shared prepaid wallet | Account-level wallet summary; assessment surfaces show only recovery context, never a separate balance. |
| Spendable and outstanding projections | Two explicitly named values on wallet, checkout confirmation and payment-required recovery. |
| Tax is not credit | Checkout separates service value, tax, payment total and credited amount. |
| Payment does not auto-resume | Confirmed payment routes back to a still-paused assessment with a separate Continue action. |
| Runtime and payment authorities are independent | Separate `PAYMENT_REQUIRED`, `NO_PROGRESS_LIMIT_EXCEEDED`, safety, unknown-usage and integrity-review state patterns. |
| Per-physical-invocation settlement | Logical-operation rows expand into each provider retry/fallback invocation. |
| Governed exact/provider/global pricing | Ordered pricing coverage list, versioned draft, preview, immutable publish confirmation and history. |
| Unknown usage is not zero | Non-monetary pending reconciliation state until an authorized terminal decision. |
| Append-only compensation | Compensation begins from an original debit, is bounded by remaining eligibility and remains a linked entry. |
| Owner/resource-scoped RBAC | Customer surfaces bind to wallet/assessment ownership; Admin actions require explicit permission. |

## Deliberately excluded or superseded

| Idea | Disposition |
|---|---|
| Per-assessment credit allocation/reservation | Rejected; conflicts with the shared-wallet product decision. |
| Automatic resume after payment | Rejected; bypasses current run/lease, pricing and runtime re-evaluation. |
| Customer-visible FX, markup or margin | Excluded; these are Admin planning inputs and not customer tariff explanations. |
| Treat timeout/incomplete usage as free | Rejected; becomes canonical state `OUTCOME_UNKNOWN`. |
| Edit/delete financial history | Rejected; debit, pricing publication and compensation remain immutable. |
| Organization membership or PBAC | Superseded; current authority is RBAC with owner/resource scope. |
| Developer invitation/task workflow | Superseded for active MVP. |
| Paid-tool billing | Deferred outside Prompt 8. |
| New arbitrary output-token/business cap | Deferred until representative telemetry supports a product decision. |

## Surface and visual-reference coverage

The LCSP Figma DS Brand, shared `LCSPLogo`, Tailwind v4.3 token layer and shadcn/Base UI component vocabulary are already approved. Prompt 8 adds behavior and composition, not a new visual direction.

| Surface | Coverage | Visual reference status |
|---|---|---|
| Wallet summary | EXPERIENCE component/state tables plus Prompt 8 UX section 4.1 | Spine-only |
| Top-up and payment status | EXPERIENCE flow/state tables plus Prompt 8 UX section 4.2 | Spine-only |
| Payment-required and Continue | EXPERIENCE key flow plus Prompt 8 UX sections 4.3-4.5 | Spine-only |
| Charge history | EXPERIENCE component table plus Prompt 8 UX section 4.6 | Spine-only |
| Pricing coverage/draft/publish | Admin key flow plus Prompt 8 UX sections 5.1-5.3 | Spine-only |
| Reconciliation/integrity/compensation | Admin key flow plus Prompt 8 UX sections 5.4-5.6 | Spine-only |

No visual decision from an approved source was dropped. Pixel mockups remain optional and must not override the spines.
