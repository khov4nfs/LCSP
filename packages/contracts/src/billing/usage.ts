import type { EffectiveRuntimeModel } from "./runtime-model.ts";

/** Provider-reported token dimensions; omitted when the provider reported nothing. */
export type ProviderReportedTokenDimensions = {
  inputTokens?: string;
  cachedInputTokens?: string;
  cacheWriteTokens?: string;
  outputTokens?: string;
  reasoningTokens?: string;
  totalTokens?: string;
};

/** Worker-to-API telemetry payload. It carries no price, charge or reservation. */
export type LlmUsageReport = ProviderReportedTokenDimensions & {
  assessmentId: string;
  runId: string;
  agentRole: string;
  provider: string;
  model: string;
  effectiveRuntimeModel?: EffectiveRuntimeModel;
  invocationId: string;
  providerResponseId?: string;
  occurredAt: string;
};

/**
 * Persistence status of a telemetry row. SETTLED only means "recorded with
 * provider-reported tokens"; no wallet movement is attached to any status.
 */
export const LLM_USAGE_STATUSES = {
  SETTLED: "SETTLED",
  UNAVAILABLE: "UNAVAILABLE",
  RETRYABLE: "RETRYABLE",
} as const;

export type LlmUsageStatus =
  (typeof LLM_USAGE_STATUSES)[keyof typeof LLM_USAGE_STATUSES];

export const LLM_USAGE_AVAILABILITY_REASONS = {
  providerUsageMetadataMissing: "PROVIDER_USAGE_METADATA_MISSING",
} as const;

export type LlmUsageAvailabilityReason =
  (typeof LLM_USAGE_AVAILABILITY_REASONS)[keyof typeof LLM_USAGE_AVAILABILITY_REASONS];
