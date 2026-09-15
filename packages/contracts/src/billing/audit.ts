export const BILLING_AUDIT_EVENT_TYPES = {
  orderCreated: "billing.order.created",
  orderExpired: "billing.order.expired",
} as const;

export type BillingAuditEventType =
  (typeof BILLING_AUDIT_EVENT_TYPES)[keyof typeof BILLING_AUDIT_EVENT_TYPES];
