import type { MessageKey } from "@lcsp/i18n";

/** Usage metric names that have a friendly label; unknown names are humanized. */
export const USAGE_METRIC_LABEL_KEYS: Record<string, MessageKey> = {
  reasoning_tokens: "pages.appShell.agentStreamUsage.metrics.reasoning_tokens",
  thinking_tokens: "pages.appShell.agentStreamUsage.metrics.thinking_tokens",
  cached_input_tokens:
    "pages.appShell.agentStreamUsage.metrics.cached_input_tokens",
  cache_read_tokens: "pages.appShell.agentStreamUsage.metrics.cache_read_tokens",
  cache_creation_input_tokens:
    "pages.appShell.agentStreamUsage.metrics.cache_creation_input_tokens",
  audio_tokens: "pages.appShell.agentStreamUsage.metrics.audio_tokens",
};

/** Shown first in the compact footer, in this order. */
export const USAGE_COMPACT_METRIC_ORDER = [
  "reasoning_tokens",
  "thinking_tokens",
  "cached_input_tokens",
  "cache_read_tokens",
] as const;

export const USAGE_COMPACT_METRIC_LIMIT = 3;
export const USAGE_DETAIL_KEY_LIMIT = 16;
export const USAGE_DETAIL_KEY_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;
