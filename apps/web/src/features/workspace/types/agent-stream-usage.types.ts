import type { MessageKey } from "@lcsp/i18n";

/**
 * Provider/runtime-reported telemetry. Tools keep their payload metrics alongside
 * correlated model usage; only accounting owners contribute tokens to totals.
 */
export type StreamRowUsage = {
  durationMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  /** Every other reported numeric usage metric, keyed by its safe metric name. */
  details?: Record<string, number>;
  bytes?: number;
  lines?: number;
  items?: number;
  truncated?: boolean;
};

export type ToolUsageAttribution = {
  identity: string;
  accountingOwner: boolean;
  usage: StreamRowUsage;
};

export type StreamUsageAggregate = {
  usage?: StreamRowUsage;
  countedModelSteps: number;
  partial: boolean;
};

export type StreamUsageOccurrence = {
  id: string;
  kind: string;
  firstSequence: number;
  usageAttribution?: ToolUsageAttribution;
  completedTurns?: StreamUsageOccurrence[];
};

export type AgentStreamUsageSummaryProps = {
  aggregate: StreamUsageAggregate;
  titleKey: MessageKey;
  className?: string;
};
