/**
 * Provider/runtime-reported telemetry of one logical activity. Model rows carry
 * token fields only; tool rows carry payload-size fields only. The two are never
 * mixed or summed together.
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
