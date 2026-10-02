import type { LlmUsageStatus } from "@lcsp/contracts/billing";

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
/** Held-credit row created before model use stopped debiting; only drained, never created. */
export type LegacyReservationRecord = {
  id: string;
  userId: string;
  walletId: string;
  remainingCredits: bigint;
  assessmentId: string | null;
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
  assessmentId: string | null;
  runId: string | null;
  agentRole: string;
  provider: string;
  model: string;
  invocationId: string;
  status: string;
  availabilityReason: string | null;
  providerResponseId: string | null;
  inputTokens: bigint | null;
  cachedInputTokens: bigint | null;
  cacheWriteTokens: bigint | null;
  outputTokens: bigint | null;
  totalTokens: bigint | null;
  reasoningTokens: bigint | null;
  runtimePolicySnapshotId: string | null;
  occurredAt: Date;
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
export interface LegacyReservationPort {
  findForUser(
    userId: string,
    id: string,
  ): Promise<LegacyReservationRecord | null>;
  listReservedForWallet(walletId: string): Promise<LegacyReservationRecord[]>;
  releaseReserved(input: {
    reservationId: string;
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
    assessmentId?: string;
    runId?: string;
    agentRole: string;
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
    runtimePolicySnapshotId?: string;
    status: LlmUsageStatus;
    availabilityReason?: string;
    occurredAt: Date;
  }): Promise<UsageRecord>;
}
export interface RuntimeModelPolicyPort {
  /**
   * Get-or-create the immutable snapshot for (role, policyVersion). A version that
   * already exists with a different provider/model is rejected; rows are never updated.
   */
  ensure(input: {
    role: string;
    provider: string;
    model: string;
    policyVersion: string;
    effectiveAt: Date;
  }): Promise<RuntimeModelPolicyRecord>;
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
  reservation: LegacyReservationPort;
  order: BillingOrderPort;
  payment: PaymentTransactionPort;
  webhook: WebhookEventPort;
  usage: LlmUsagePort;
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
