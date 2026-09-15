import type { EffectiveRuntimeModel } from "./runtime-model.ts";

/** Provider adapters must emit disjoint billable dimensions; totalTokens is informational. */
export type CanonicalBillableUsageDimensions = {
  inputTokens?: string;
  cachedInputTokens?: string;
  cacheWriteTokens?: string;
  outputTokens?: string;
  reasoningTokens?: string;
};

/** Worker-to-API accounting payload. Estimates must never use this settled shape. */
export type SettledUsageInput = CanonicalBillableUsageDimensions & {
  userId: string;
  reservationId: string;
  agentRole: string;
  effectiveRuntimeModel: EffectiveRuntimeModel;
  invocationId: string;
  providerResponseId?: string;
  totalTokens?: string;
  occurredAt: string;
};
