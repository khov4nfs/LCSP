import type { EffectiveRuntimeModel } from "@lcsp/contracts/billing";

export type LlmUsageRecordInput = {
  userId: string;
  assessmentId: string;
  runId: string;
  invocationId: string;
  agentRole: string;
  provider: string;
  model: string;
  effectiveRuntimeModel?: EffectiveRuntimeModel;
  providerResponseId?: string;
  inputTokens?: bigint;
  cachedInputTokens?: bigint;
  cacheWriteTokens?: bigint;
  outputTokens?: bigint;
  reasoningTokens?: bigint;
  totalTokens?: bigint;
  occurredAt: Date;
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
