/**
 * Canonical action identifiers for billing, pricing governance, and reconciliation authorization.
 * Rationale ("Why"): ADR-028 Line 177 mandates explicit shared contract actions distinct for
 * pricing draft, pricing publish/supersede, platform sponsorship, reconciliation decision,
 * compensation, and goodwill credit.
 * Invariants & Constraints: Defined as frozen `as const` SCREAMING_SNAKE_CASE object with derived union type.
 */
export const BILLING_ACTIONS = {
  pricingDraftCreate: "billing:pricing_draft:create",
  pricingDraftUpdate: "billing:pricing_draft:update",
  pricingPublish: "billing:pricing:publish",
  pricingSupersede: "billing:pricing:supersede",
  platformSponsorship: "billing:platform_sponsorship",
  reconciliationDecision: "billing:reconciliation:decision",
  compensation: "billing:debit:compensate",
  goodwillCredit: "billing:goodwill_credit",
} as const;

export type BillingAction =
  (typeof BILLING_ACTIONS)[keyof typeof BILLING_ACTIONS];
