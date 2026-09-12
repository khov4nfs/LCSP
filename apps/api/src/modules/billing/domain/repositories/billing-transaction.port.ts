export type WalletRecord = { id: string; userId: string; version: number };
export type LedgerRecord = {
  id: string;
  walletId: string;
  userId: string;
  deltaCredits: bigint;
  idempotencyKey: string;
  source: string;
  referenceId: string | null;
  billingOrderId: string | null;
};
export type ReservationRecord = {
  id: string;
  userId: string;
  walletId: string;
  amountCredits: bigint;
  status: string;
};
export type OrderRecord = {
  id: string;
  userId: string;
  paymentCode: string;
  idempotencyKey: string;
  requestFingerprint: string | null;
  status: string;
  amountMinorUnits: bigint;
  creditUnits: bigint;
};
export type PaymentRecord = {
  id: string;
  provider: string;
  providerTransactionId: string;
  amountMinorUnits: bigint;
  reconciliationStatus: string;
  userId: string | null;
  billingOrderId: string | null;
};
export type UsageRecord = {
  id: string;
  userId: string;
  provider: string;
  model: string;
  invocationId: string;
  providerResponseId: string | null;
  inputTokens: bigint | null;
  outputTokens: bigint | null;
  totalTokens: bigint | null;
  pricingSnapshotId: string | null;
  reservationId: string | null;
  chargedCredits: bigint | null;
  occurredAt: Date;
};
export type PricingRecord = {
  id: string;
  provider: string;
  model: string;
  inputPricePerMillion: string;
  outputPricePerMillion: string;
  version: number;
  effectiveAt: Date;
};

export interface BillingWalletPort {
  findForUser(userId: string): Promise<WalletRecord | null>;
  getOrCreateForUser(userId: string): Promise<WalletRecord>;
  compareAndSetProjection(input: {
    walletId: string;
    expectedVersion: number;
    availableCredits: bigint;
    reservedCredits: bigint;
  }): Promise<boolean>;
}
export interface CreditLedgerPort {
  findByIdempotencyKey(key: string): Promise<LedgerRecord | null>;
  append(input: {
    userId: string;
    walletId: string;
    deltaCredits: bigint;
    idempotencyKey: string;
    source: string;
    referenceId?: string;
    billingOrderId?: string;
  }): Promise<LedgerRecord>;
  listForWallet(walletId: string): Promise<LedgerRecord[]>;
}
export interface BillingReservationPort {
  findForUser(userId: string, id: string): Promise<ReservationRecord | null>;
  findByIdempotencyKey(
    userId: string,
    key: string,
  ): Promise<ReservationRecord | null>;
  createReserved(input: {
    userId: string;
    walletId: string;
    amountCredits: bigint;
    idempotencyKey: string;
  }): Promise<ReservationRecord>;
  listReservedForWallet(walletId: string): Promise<ReservationRecord[]>;
  transitionFromReserved(input: {
    reservationId: string;
    to: "SETTLED" | "RELEASED";
    timestamp: Date;
  }): Promise<boolean>;
}
export interface BillingOrderPort {
  findByPaymentCode(paymentCode: string): Promise<OrderRecord | null>;
  findByIdempotencyKey(
    userId: string,
    key: string,
  ): Promise<OrderRecord | null>;
  createPending(input: {
    userId: string;
    paymentCode: string;
    idempotencyKey: string;
    requestFingerprint?: string;
    amountMinorUnits: bigint;
    creditUnits: bigint;
  }): Promise<OrderRecord>;
  transition(
    orderId: string,
    from: "PENDING_PAYMENT" | "PENDING_RECONCILIATION",
    to: "CREDITED" | "EXPIRED" | "CANCELLED" | "PENDING_RECONCILIATION",
  ): Promise<boolean>;
}
export interface PaymentTransactionPort {
  findByProviderTransaction(
    provider: string,
    id: string,
  ): Promise<PaymentRecord | null>;
  create(input: {
    provider: string;
    providerTransactionId: string;
    amountMinorUnits: bigint;
    userId?: string;
    billingOrderId?: string;
    webhookEventId?: string;
    reconciliationStatus: string;
  }): Promise<PaymentRecord>;
  setStatus(
    id: string,
    status: string,
    userId?: string,
    billingOrderId?: string,
  ): Promise<PaymentRecord>;
}
export interface WebhookEventPort {
  recordReceived(input: {
    provider: string;
    providerTransactionId: string;
    sanitizedPayload?: unknown;
  }): Promise<{ id: string }>;
}
export interface LlmUsagePort {
  findByInvocation(
    userId: string,
    invocationId: string,
  ): Promise<UsageRecord | null>;
  findByProviderResponse(
    provider: string,
    responseId: string,
  ): Promise<UsageRecord | null>;
  create(input: {
    userId: string;
    provider: string;
    model: string;
    invocationId: string;
    providerResponseId?: string;
    inputTokens?: bigint;
    outputTokens?: bigint;
    totalTokens?: bigint;
    pricingSnapshotId?: string;
    reservationId: string;
    chargedCredits: bigint;
    occurredAt?: Date;
  }): Promise<UsageRecord>;
}
export interface PricingSnapshotPort {
  findById(id: string): Promise<PricingRecord | null>;
  findApplicable(
    provider: string,
    model: string,
    occurredAt: Date,
  ): Promise<PricingRecord | null>;
}
export type BillingTransactionRepositories = {
  wallet: BillingWalletPort;
  ledger: CreditLedgerPort;
  reservation: BillingReservationPort;
  order: BillingOrderPort;
  payment: PaymentTransactionPort;
  webhook: WebhookEventPort;
  usage: LlmUsagePort;
  pricing: PricingSnapshotPort;
  lockUserAccount(userId: string): Promise<void>;
};
export interface BillingTransactionPort {
  runForUser<T>(
    userId: string,
    operation: (repositories: BillingTransactionRepositories) => Promise<T>,
  ): Promise<T>;
}

export const BILLING_TRANSACTION_PORT = Symbol("BILLING_TRANSACTION_PORT");
