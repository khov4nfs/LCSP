import { PAYMENT_RECONCILIATION_STATUSES } from "./statuses.ts";
import type {
  BillingAdminDashboard as BillingAdminDashboardSchema,
  BillingAdminPaymentRow as BillingAdminPaymentRowSchema,
  BillingAdminSummary as BillingAdminSummarySchema,
} from "./schemas.ts";

export const BILLING_ADMIN_PERIODS = {
  mtd: "MTD",
  d7: "7D",
  d30: "30D",
  d90: "90D",
} as const;

export type BillingAdminPeriod =
  (typeof BILLING_ADMIN_PERIODS)[keyof typeof BILLING_ADMIN_PERIODS];

export const BILLING_ADMIN_PAYMENT_FILTERS = {
  all: "ALL",
  matched: PAYMENT_RECONCILIATION_STATUSES.MATCHED,
  unmatched: PAYMENT_RECONCILIATION_STATUSES.UNMATCHED,
  amountMismatch: PAYMENT_RECONCILIATION_STATUSES.AMOUNT_MISMATCH,
  duplicate: PAYMENT_RECONCILIATION_STATUSES.DUPLICATE,
  rejected: PAYMENT_RECONCILIATION_STATUSES.REJECTED,
  needsReview: PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW,
} as const;

export type BillingAdminPaymentFilter =
  (typeof BILLING_ADMIN_PAYMENT_FILTERS)[keyof typeof BILLING_ADMIN_PAYMENT_FILTERS];

export const BILLING_ADMIN_GATEWAYS = {
  all: "ALL",
  sepay: "SEPAY",
} as const;

export type BillingAdminGateway =
  (typeof BILLING_ADMIN_GATEWAYS)[keyof typeof BILLING_ADMIN_GATEWAYS];

export type BillingAdminSummary = BillingAdminSummarySchema;
export type BillingAdminPaymentRow = BillingAdminPaymentRowSchema;
export type BillingAdminDashboard = BillingAdminDashboardSchema;
