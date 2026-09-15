export const PREPAID_BILLING_CONFIG = {
  currency: "VND",
  minimumAmountVnd: 10_000n,
  maximumAmountVnd: 10_000_000n,
  amountStepVnd: 1_000n,
  creditUnitsPerVnd: 1n,
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

export type BillingWalletView = {
  walletId: string;
  availableCredits: string;
  reservedCredits: string;
  totalCredits: string;
  version: number;
};

export type BillingOrderView = {
  id: string;
  amountVnd: string;
  creditUnits: string;
  paymentCode: string;
  status: string;
  expiresAt: string | null;
  creditedAt: string | null;
  createdAt: string;
  updatedAt: string;
  paymentInstructions: {
    provider: typeof BILLING_PAYMENT_PROVIDERS.sepay;
    currency: "VND";
    paymentCode: string;
    amountVnd: string;
    bankName: string;
    bankAccountNumber: string;
    accountHolder: string;
    transferContent: string;
    qrCodeUrl: string;
  };
};

export type BillingHistoryView = {
  orders: BillingOrderView[];
  page: number;
  pageSize: number;
  totalCount: number;
};
