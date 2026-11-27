export const BILLING_AUDIT_EVENT_TYPES = {
  orderCreated: "billing.order.created",
  orderExpired: "billing.order.expired",
  reconciliationDecided: "billing.reconciliation.decided",
  reconciliationSettled: "billing.reconciliation.settled",
  usageSettled: "billing.invocation.usage_settled",
  leaseSwept: "billing.reconciliation.lease_swept",
  compensationIssued: "billing.debit.compensated",
} as const;

export type BillingAuditEventType =
  (typeof BILLING_AUDIT_EVENT_TYPES)[keyof typeof BILLING_AUDIT_EVENT_TYPES];

/**
 * Canonical audit event types for WP8 Phase B2 customer model tariff governance.
 * Why: Distinguishes draft creation/updates, atomic snapshot publication, and assignment superseding in AuditEvent.
 * How: Uses SCREAMING_SNAKE_CASE constants in an `as const` object with a derived union type.
 * Invariants: Preserves legacy `BILLING_AUDIT_EVENT_TYPES` untouched for backward compatibility.
 */
export const MODEL_PRICING_AUDIT_EVENT_TYPES = {
  draftCreated: "MODEL_PRICING_DRAFT_CREATED",
  draftUpdated: "MODEL_PRICING_DRAFT_UPDATED",
  published: "MODEL_PRICING_PUBLISHED",
  assignmentSuperseded: "MODEL_PRICING_ASSIGNMENT_SUPERSEDED",
} as const;

export type ModelPricingAuditEventType =
  (typeof MODEL_PRICING_AUDIT_EVENT_TYPES)[keyof typeof MODEL_PRICING_AUDIT_EVENT_TYPES];
