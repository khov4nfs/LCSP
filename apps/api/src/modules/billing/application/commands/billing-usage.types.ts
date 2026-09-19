import type { EffectiveRuntimeModel } from "@lcsp/contracts/billing";

export type BillingUsageReservationInput = {
  assessmentId: string;
  runId: string;
  amountCredits: bigint;
  maxChargeCredits: bigint;
  provider: string;
  model: string;
  maxInputTokens: bigint;
  maxOutputTokens: bigint;
  maxReasoningTokens: bigint;
  maxInvocations: bigint;
  authorizedModels: Array<{ provider: string; model: string }>;
  idempotencyKey: string;
};

export type BillingUsageReleaseInput = {
  assessmentId: string;
  reservationId: string;
};

export type BillingUsageClaimInput = {
  assessmentId: string;
  reservationId: string;
  invocationId: string;
};

export type BillingUsageSettlementInput = {
  userId: string;
  assessmentId?: string;
  runId?: string;
  reservationId: string;
  invocationId: string;
  agentRole: string;
  provider?: string;
  model?: string;
  effectiveRuntimeModel?: EffectiveRuntimeModel;
  providerResponseId?: string;
  inputTokens?: bigint;
  cachedInputTokens?: bigint;
  cacheWriteTokens?: bigint;
  outputTokens?: bigint;
  reasoningTokens?: bigint;
  totalTokens?: bigint;
  occurredAt?: Date;
};

export type BillingOrderAudit = {
  correlationId: string;
  sessionId?: string;
};

export type BillingAdminResolveInput = {
  paymentId: string;
  billingOrderId: string;
  expectedVersion: number;
  rationale: string;
  actorId: string;
  correlationId: string;
};

export type BillingAdminRejectInput = {
  paymentId: string;
  expectedStatus: string;
  expectedVersion: number;
  rationale: string;
  actorId: string;
  correlationId: string;
};

export type SePayWebhookInput = {
  rawBody: Buffer;
  signature?: string;
  timestamp?: string;
  now?: Date;
};
