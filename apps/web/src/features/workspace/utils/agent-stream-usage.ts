import {
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
  type AssessmentAgentStreamEvent,
} from "@lcsp/contracts/evidence";
import { resolveMessage, type MessageKey } from "@lcsp/i18n";

import { appLocale } from "@/lib/locale";

import {
  USAGE_COMPACT_METRIC_LIMIT,
  USAGE_COMPACT_METRIC_ORDER,
  USAGE_DETAIL_KEY_LIMIT,
  USAGE_DETAIL_KEY_PATTERN,
  USAGE_METRIC_LABEL_KEYS,
} from "../config/agent-stream-usage";
import type { StreamRowUsage } from "../types/agent-stream-usage.types";

type Rec = Record<string, unknown>;

function record(value: unknown): Rec | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Rec)
    : null;
}

/** Only genuine finite non-negative numbers; strings/NaN/negatives are dropped. */
function count(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function defined(value: Rec): StreamRowUsage | undefined {
  const kept = Object.fromEntries(
    Object.entries(value).filter(([, v]) => v !== undefined),
  );
  return Object.keys(kept).length > 0 ? (kept as StreamRowUsage) : undefined;
}

function parseDetails(value: unknown): Record<string, number> | undefined {
  const source = record(value);
  if (!source) return undefined;
  const details: Record<string, number> = {};
  for (const [rawKey, raw] of Object.entries(source)) {
    if (Object.keys(details).length >= USAGE_DETAIL_KEY_LIMIT) break;
    const key = rawKey.toLowerCase();
    const n = count(raw);
    if (n !== undefined && USAGE_DETAIL_KEY_PATTERN.test(key)) details[key] = n;
  }
  return Object.keys(details).length > 0 ? details : undefined;
}

function eventDurationMs(
  data: Rec,
  started: AssessmentAgentStreamEvent | undefined,
  completed: AssessmentAgentStreamEvent,
): number | undefined {
  const reported = count(data.duration_ms);
  if (reported !== undefined) return reported;
  if (!started) return undefined;
  const elapsed = Date.parse(completed.emittedAt) - Date.parse(started.emittedAt);
  return Number.isFinite(elapsed) && elapsed > 0 ? elapsed : undefined;
}

/**
 * Usage of one logical model turn: that of its (last) MODEL_CALL_COMPLETED. It is
 * never summed across provider attempts; failed attempts report none.
 */
export function modelTurnUsage(
  events: AssessmentAgentStreamEvent[],
): StreamRowUsage | undefined {
  const completed = events
    .filter(
      (e) => e.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallCompleted,
    )
    .reduce<AssessmentAgentStreamEvent | undefined>(
      (a, b) => (!a || b.sequence >= a.sequence ? b : a),
      undefined,
    );
  if (!completed) return undefined;
  const data = record(completed.data) ?? {};
  const usage = record(data.usage);
  const started = events.find(
    (e) => e.eventType === ASSESSMENT_AGENT_STREAM_EVENT_TYPES.modelCallStarted,
  );
  return defined({
    durationMs: eventDurationMs(data, started, completed),
    inputTokens: count(usage?.input_tokens),
    outputTokens: count(usage?.output_tokens),
    totalTokens: count(usage?.total_tokens),
    details: parseDetails(usage?.details),
  });
}

/** Model-independent size/duration of the payload a tool handed to the agent. */
export function toolCallMetrics(
  events: AssessmentAgentStreamEvent[],
): StreamRowUsage | undefined {
  const metrics = events
    .filter((e) => record(record(e.data)?.result_metrics))
    .reduce<AssessmentAgentStreamEvent | undefined>(
      (a, b) => (!a || b.sequence >= a.sequence ? b : a),
      undefined,
    );
  const source = record(record(metrics?.data)?.result_metrics);
  if (!source) return undefined;
  return defined({
    durationMs: count(source.duration_ms),
    bytes: count(source.bytes),
    lines: count(source.lines),
    items: count(source.items),
    truncated: source.truncated === true ? true : undefined,
  });
}

function t(key: MessageKey) {
  return resolveMessage(appLocale, key);
}

function fill(key: MessageKey, value: string) {
  return t(key).replace("{value}", value);
}

function num(value: number, maximumFractionDigits = 1) {
  return new Intl.NumberFormat(appLocale, { maximumFractionDigits }).format(value);
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000) return `${num(value / 1_000_000)}M`;
  if (value >= 1_000) return `${num(value / 1_000)}k`;
  return num(value, 0);
}

export function formatByteSize(value: number): string {
  if (value >= 1024 * 1024) return `${num(value / (1024 * 1024))} MB`;
  if (value >= 1024) return `${num(value / 1024)} KB`;
  return `${num(value, 0)} B`;
}

export function formatUsageDuration(ms: number): string {
  return ms >= 1000 ? `${num(ms / 1000)}s` : `${num(ms, 0)} ms`;
}

/** Humanize an unknown metric name so a new provider metric needs no release. */
export function usageMetricLabel(key: string, formattedValue: string): string {
  const known = Object.hasOwn(USAGE_METRIC_LABEL_KEYS, key)
    ? USAGE_METRIC_LABEL_KEYS[key]
    : undefined;
  if (known) return fill(known, formattedValue);
  return `${formattedValue} ${key.replaceAll("_", " ")}`;
}

function compactDetails(details: Record<string, number>): string[] {
  const known = USAGE_COMPACT_METRIC_ORDER.filter((k) => k in details);
  const rest = Object.keys(details)
    .filter((k) => !(known as string[]).includes(k))
    .sort();
  return [...known, ...rest]
    .slice(0, USAGE_COMPACT_METRIC_LIMIT)
    .map((k) => usageMetricLabel(k, formatTokenCount(details[k]!)));
}

/** Compact footer segments; empty when nothing was reported. */
export function usageFooterParts(usage: StreamRowUsage | undefined): string[] {
  if (!usage) return [];
  const parts: string[] = [];
  const duration =
    usage.durationMs === undefined ? [] : [formatUsageDuration(usage.durationMs)];
  const isTool =
    usage.bytes !== undefined ||
    usage.lines !== undefined ||
    usage.items !== undefined;
  if (!isTool) parts.push(...duration);
  const p = "pages.appShell.agentStreamUsage.";
  if (usage.inputTokens !== undefined) {
    parts.push(fill(`${p}input` as MessageKey, formatTokenCount(usage.inputTokens)));
  }
  if (usage.outputTokens !== undefined) {
    parts.push(fill(`${p}output` as MessageKey, formatTokenCount(usage.outputTokens)));
  }
  if (
    usage.inputTokens === undefined &&
    usage.outputTokens === undefined &&
    usage.totalTokens !== undefined
  ) {
    parts.push(fill(`${p}total` as MessageKey, formatTokenCount(usage.totalTokens)));
  }
  if (usage.details) parts.push(...compactDetails(usage.details));
  if (usage.lines !== undefined) {
    parts.push(fill(`${p}lines` as MessageKey, num(usage.lines, 0)));
  }
  if (usage.items !== undefined) {
    parts.push(fill(`${p}items` as MessageKey, num(usage.items, 0)));
  }
  if (usage.bytes !== undefined) parts.push(formatByteSize(usage.bytes));
  if (usage.truncated) parts.push(t(`${p}truncated` as MessageKey));
  if (isTool) parts.push(...duration);
  return parts;
}
