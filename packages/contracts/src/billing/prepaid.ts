import type {
  BillingHistoryView as BillingHistoryViewSchema,
  BillingOrderView as BillingOrderViewSchema,
  BillingUsageEstimate as BillingUsageEstimateSchema,
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

/** The root runtime route is the customer-facing default estimate context. */
export const BILLING_ESTIMATE_RUNTIME_ROLE = "root" as const;

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

export const BILLING_ESTIMATE_AVAILABILITY = {
  available: "AVAILABLE",
  insufficientPricingConfiguration: "INSUFFICIENT_PRICING_CONFIGURATION",
} as const;

export type BillingEstimateAvailability =
  (typeof BILLING_ESTIMATE_AVAILABILITY)[keyof typeof BILLING_ESTIMATE_AVAILABILITY];

export type BillingUsageEstimate = BillingUsageEstimateSchema;
export type BillingWalletView = BillingWalletViewSchema;
export type BillingOrderView = BillingOrderViewSchema;
export type BillingHistoryView = BillingHistoryViewSchema;
