import {
  BILLING_ADMIN_GATEWAYS,
  BILLING_ADMIN_PAYMENT_FILTERS,
  BILLING_ADMIN_PERIODS,
  PAYMENT_RECONCILIATION_STATUSES,
} from "@lcsp/contracts/billing";
import type { MessageKey } from "@lcsp/i18n";

export const BILLING_ADMIN_PAGE_SIZE = 3;

export const BILLING_ADMIN_PERIOD_OPTIONS = [
  {
    value: BILLING_ADMIN_PERIODS.mtd,
    labelKey: "pages.admin.billing.periods.mtd",
  },
  {
    value: BILLING_ADMIN_PERIODS.d7,
    labelKey: "pages.admin.billing.periods.d7",
  },
  {
    value: BILLING_ADMIN_PERIODS.d30,
    labelKey: "pages.admin.billing.periods.d30",
  },
  {
    value: BILLING_ADMIN_PERIODS.d90,
    labelKey: "pages.admin.billing.periods.d90",
  },
] as const satisfies ReadonlyArray<{ value: string; labelKey: MessageKey }>;

export const BILLING_ADMIN_GATEWAY_OPTIONS = [
  {
    value: BILLING_ADMIN_GATEWAYS.all,
    labelKey: "pages.admin.billing.gateways.all",
  },
  {
    value: BILLING_ADMIN_GATEWAYS.sepay,
    labelKey: "pages.admin.billing.gateways.sepay",
  },
] as const satisfies ReadonlyArray<{ value: string; labelKey: MessageKey }>;

export const BILLING_ADMIN_FILTER_OPTIONS = [
  {
    value: BILLING_ADMIN_PAYMENT_FILTERS.all,
    labelKey: "pages.admin.billing.filters.all",
  },
  {
    value: PAYMENT_RECONCILIATION_STATUSES.MATCHED,
    labelKey: "pages.admin.billing.status.matched",
  },
  {
    value: PAYMENT_RECONCILIATION_STATUSES.UNMATCHED,
    labelKey: "pages.admin.billing.status.unmatched",
  },
  {
    value: PAYMENT_RECONCILIATION_STATUSES.AMOUNT_MISMATCH,
    labelKey: "pages.admin.billing.status.amountMismatch",
  },
  {
    value: PAYMENT_RECONCILIATION_STATUSES.DUPLICATE,
    labelKey: "pages.admin.billing.status.duplicate",
  },
  {
    value: PAYMENT_RECONCILIATION_STATUSES.REJECTED,
    labelKey: "pages.admin.billing.status.rejected",
  },
  {
    value: PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW,
    labelKey: "pages.admin.billing.status.needsReview",
  },
] as const satisfies ReadonlyArray<{ value: string; labelKey: MessageKey }>;

export const BILLING_ADMIN_STATUS_LABEL_KEYS = {
  [PAYMENT_RECONCILIATION_STATUSES.MATCHED]:
    "pages.admin.billing.status.matched",
  [PAYMENT_RECONCILIATION_STATUSES.UNMATCHED]:
    "pages.admin.billing.status.unmatched",
  [PAYMENT_RECONCILIATION_STATUSES.AMOUNT_MISMATCH]:
    "pages.admin.billing.status.amountMismatch",
  [PAYMENT_RECONCILIATION_STATUSES.DUPLICATE]:
    "pages.admin.billing.status.duplicate",
  [PAYMENT_RECONCILIATION_STATUSES.REJECTED]:
    "pages.admin.billing.status.rejected",
  [PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW]:
    "pages.admin.billing.status.needsReview",
} as const satisfies Record<
  keyof typeof PAYMENT_RECONCILIATION_STATUSES,
  MessageKey
>;
