export type WalletRecord = {
  id: string;
  userId: string;
  availableCredits: bigint;
  reservedCredits: bigint;
  version: number;
};
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
  expiresAt: Date | null;
  creditedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};
export type PaymentRecord = {
  id: string;
  provider: string;
  providerTransactionId: string;
  amountMinorUnits: bigint;
  reconciliationStatus: string;
  reconciliationReason: string | null;
  reconciliationVersion: number;
  reconciledAt: Date | null;
  userId: string | null;
  billingOrderId: string | null;
  webhookEventId: string | null;
};
export type UsageRecord = {
  id: string;
  userId: string;
  provider: string;
  model: string;
  invocationId: string;
  providerResponseId: string | null;
  inputTokens: bigint | null;
  cachedInputTokens: bigint | null;
  cacheWriteTokens: bigint | null;
  outputTokens: bigint | null;
  totalTokens: bigint | null;
  reasoningTokens: bigint | null;
  pricingSnapshotId: string | null;
  runtimePolicySnapshotId: string | null;
  reservationId: string | null;
  chargedCredits: bigint | null;
  providerCostCredits: bigint | null;
  customerChargeVnd: bigint | null;
  occurredAt: Date;
};
export type PricingRecord = {
  id: string;
  provider: string;
  model: string;
  inputPricePerMillion: string;
  cachedInputPricePerMillion?: string;
  cacheWritePricePerMillion?: string;
  outputPricePerMillion: string;
  reasoningPricePerMillion?: string;
  version: number;
  effectiveAt: Date;
  providerCurrency?: string;
  customerCurrency?: string;
  markupBps?: bigint;
  fxRateVndNumerator?: bigint;
  fxRateVndDenominator?: bigint;
};
export type RuntimeModelPolicyRecord = {
  id: string;
  role: string;
  provider: string;
  model: string;
  policyVersion: string;
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
  findByPaymentCodes(paymentCodes: string[]): Promise<OrderRecord[]>;
  findById(orderId: string): Promise<OrderRecord | null>;
  findByIdempotencyKey(
    userId: string,
    key: string,
  ): Promise<OrderRecord | null>;
  findForUser(userId: string, id: string): Promise<OrderRecord | null>;
  listForUser(input: {
    userId: string;
    skip: number;
    take: number;
  }): Promise<{ orders: OrderRecord[]; totalCount: number }>;
  createPending(input: {
    userId: string;
    paymentCode: string;
    idempotencyKey: string;
    requestFingerprint?: string;
    amountMinorUnits: bigint;
    creditUnits: bigint;
    expiresAt?: Date;
  }): Promise<OrderRecord>;
  transition(
    orderId: string,
    from: "PENDING_PAYMENT" | "PENDING_RECONCILIATION" | "EXPIRED",
    to: "CREDITED" | "EXPIRED" | "CANCELLED" | "PENDING_RECONCILIATION",
  ): Promise<boolean>;
}
export interface PaymentTransactionPort {
  findById(id: string): Promise<PaymentRecord | null>;
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
    reconciliationReason?: string;
    reconciledAt?: Date;
  }): Promise<PaymentRecord>;
  setStatus(
    id: string,
    status: string,
    userId?: string,
    billingOrderId?: string,
    reason?: string | null,
    expectedVersion?: number,
  ): Promise<PaymentRecord>;
}
export interface WebhookEventPort {
  recordReceived(input: {
    provider: string;
    providerTransactionId: string;
    sanitizedPayload?: unknown;
  }): Promise<{ id: string }>;
  findAcceptedById(id: string): Promise<{
    id: string;
    provider: string;
    providerTransactionId: string;
    paymentCode: string | null;
    paymentCodes: string[];
    amountMinorUnits: bigint;
    transferDirection: "IN" | "OUT" | "UNKNOWN";
    sanitizedPayload: unknown;
    securityAcceptedAt: Date | null;
    processedAt: Date | null;
  } | null>;
  markProcessed(id: string, processedAt: Date): Promise<boolean>;
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
    cachedInputTokens?: bigint;
    cacheWriteTokens?: bigint;
    outputTokens?: bigint;
    reasoningTokens?: bigint;
    totalTokens?: bigint;
    pricingSnapshotId?: string;
    runtimePolicySnapshotId?: string;
    reservationId: string;
    chargedCredits: bigint;
    providerCostCredits?: bigint;
    customerChargeVnd?: bigint;
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
export interface RuntimeModelPolicyPort {
  findApplicable(
    role: string,
    occurredAt: Date,
  ): Promise<RuntimeModelPolicyRecord | null>;
}
export interface BillingAuditPort {
  append(input: {
    eventType: string;
    actorId: string | null;
    sessionId?: string;
    correlationId: string;
    resourceId: string;
    payload: Record<string, unknown>;
  }): Promise<void>;
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
  audit: BillingAuditPort;
  runtimePolicy: RuntimeModelPolicyPort;
  lockUserAccount(userId: string): Promise<void>;
};
export interface BillingTransactionPort {
  runForUser<T>(
    userId: string,
    operation: (repositories: BillingTransactionRepositories) => Promise<T>,
  ): Promise<T>;
}

export const BILLING_TRANSACTION_PORT = Symbol("BILLING_TRANSACTION_PORT");
