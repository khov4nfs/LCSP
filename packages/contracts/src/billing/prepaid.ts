import type {
  BillingHistoryView as BillingHistoryViewSchema,
  BillingOrderView as BillingOrderViewSchema,
  BillingPrepaidEstimate as BillingPrepaidEstimateSchema,
  BillingWalletView as BillingWalletViewSchema,
} from "./schemas.ts";

export const PREPAID_BILLING_CONFIG = {
  currency: "VND",
  minimumAmountVnd: "10000",
  maximumAmountVnd: "10000000",
  amountStepVnd: "1000",
  creditUnitsPerVnd: "1",
  orderExpiryHours: 24,
  paymentCodePrefix: "LCSP",
} as const;

export const BILLING_PAYMENT_PROVIDERS = {
  sepay: "SEPAY",
} as const;

export type BillingPaymentProvider =
  (typeof BILLING_PAYMENT_PROVIDERS)[keyof typeof BILLING_PAYMENT_PROVIDERS];

export type PrepaidOrderInput = {
  amountVnd: string;
};

export type PrepaidEstimate = {
  currency: typeof PREPAID_BILLING_CONFIG.currency;
  amountVnd: string;
  creditUnits: string;
  expiresInHours: number;
};

export type BillingPrepaidEstimate = BillingPrepaidEstimateSchema;
export type BillingWalletView = BillingWalletViewSchema;
export type BillingOrderView = BillingOrderViewSchema;
export type BillingHistoryView = BillingHistoryViewSchema;
