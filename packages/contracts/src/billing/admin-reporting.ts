import type {
  BillingOrderStatus,
  PaymentReconciliationReason,
  PaymentReconciliationStatus,
} from "./statuses.ts";

export const BILLING_ADMIN_REPORTING = {
  currency: "VND",
  defaultPageSize: 20,
  maxPageSize: 100,
  maxPeriodDays: 365,
} as const;

export const BILLING_USAGE_REVENUE_SOURCES = {
  llmUsageDebit: "LLM_USAGE_DEBIT",
  reservationSettlement: "RESERVATION_SETTLEMENT",
} as const;

export const BILLING_DUPLICATE_REPORTING_SCOPES = {
  durablePaymentTransactions: "DURABLE_PAYMENT_TRANSACTIONS",
} as const;

export const BILLING_PENDING_RECONCILIATION_STATUSES = [
  "UNMATCHED",
  "AMOUNT_MISMATCH",
  "NEEDS_REVIEW",
] as const satisfies readonly PaymentReconciliationStatus[];

export type BillingAdminReportPeriod = {
  from: string;
  to: string;
};

export type BillingAdminMoneyAggregate = {
  amountMinorUnits: string;
  count: number;
};

export type BillingAdminRevenueSummary = {
  period: BillingAdminReportPeriod;
  currency: typeof BILLING_ADMIN_REPORTING.currency;
  settledTopUps: BillingAdminMoneyAggregate;
  usageRevenue: BillingAdminMoneyAggregate;
  outstandingCredits: {
    credits: string;
    asOf: string;
  };
  pendingReconciliation: { count: number };
  duplicateBlocked: {
    count: number;
    scope: (typeof BILLING_DUPLICATE_REPORTING_SCOPES)[keyof typeof BILLING_DUPLICATE_REPORTING_SCOPES];
  };
};

export type BillingAdminTransactionItem = {
  paymentId: string;
  provider: string;
  providerTransactionId: string;
  amountMinorUnits: string;
  reconciliationStatus: PaymentReconciliationStatus;
  reconciliationReason: PaymentReconciliationReason | null;
  user: { id: string; email: string } | null;
  order: {
    id: string;
    paymentCode: string;
    status: BillingOrderStatus;
    amountMinorUnits: string;
    creditUnits: string;
  } | null;
  receivedAt: string;
  reconciledAt: string | null;
};

export type BillingAdminTransactionPage = {
  items: BillingAdminTransactionItem[];
  pageSize: number;
  total: number;
  hasNext: boolean;
  nextCursor: string | null;
};
