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
  assessmentId: string;
  runId: string;
  reservationId: string;
  agentRole: string;
  provider: string;
  model: string;
  effectiveRuntimeModel?: EffectiveRuntimeModel;
  invocationId: string;
  providerResponseId?: string;
  totalTokens?: string;
  occurredAt: string;
};

export const LLM_USAGE_STATUSES = {
  SETTLED: "SETTLED",
  UNAVAILABLE: "UNAVAILABLE",
  RETRYABLE: "RETRYABLE",
} as const;

export type LlmUsageStatus =
  (typeof LLM_USAGE_STATUSES)[keyof typeof LLM_USAGE_STATUSES];

export const LLM_USAGE_AVAILABILITY_REASONS = {
  providerUsageMetadataMissing: "PROVIDER_USAGE_METADATA_MISSING",
  pricingSnapshotMissing: "PRICING_SNAPSHOT_MISSING",
  pricingSnapshotInvalid: "PRICING_SNAPSHOT_INVALID",
  runtimePolicySnapshotMissing: "RUNTIME_POLICY_SNAPSHOT_MISSING",
} as const;

export type LlmUsageAvailabilityReason =
  (typeof LLM_USAGE_AVAILABILITY_REASONS)[keyof typeof LLM_USAGE_AVAILABILITY_REASONS];
