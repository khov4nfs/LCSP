import { NextMetricCard } from "@/components/molecules/next-metric-card";
import { NEXT_METRIC_VARIANTS } from "@/components/types/dashboard-primitives.types";
import { resolveAppMessage } from "@/lib/i18n";
import type { MessageKey } from "@lcsp/i18n";

import {
  USAGE_SUMMARY_FIELDS,
  USAGE_TOKEN_FIELDS,
} from "../../config/admin-usage.config";
import type { UsageMetricsProps } from "../../types/admin-usage.types";

/**
 * Business purpose: Display admin AI token usage summary metrics, token composition bar, and estimated reference costs.
 * Business rules:
 * - Primary token totals and call counters use shared NextMetricCard variants aligned to Figma 1837:14045 and 1826:13606.
 * - Unknown token counts and incomplete costs remain explicitly visible without fabricating missing telemetry or wallet debits.
 * Execution flow:
 * 1. Render token spotlight cards (total, input, output) with NextMetricCard embedded variant.
 * 2. Compute input/output share bar when known input + output > 0.
 * 3. Render call-summary indicators, estimated cost card, and detailed token bucket breakdown.
 * Failure cases:
 * - Zero or non-numeric token strings safely skip the composition percentage bar without division-by-zero errors.
 * Side effects:
 * - Pure presentational component.
 */
export function AdminUsageMetrics({ summary }: UsageMetricsProps) {
  const m = (key: string) =>
    resolveAppMessage(`pages.admin.usage.${key}` as MessageKey);

  const inputKnown = safeBigInt(summary.tokens.inputTokens?.known);
  const outputKnown = safeBigInt(summary.tokens.outputTokens?.known);
  const ioTotal = inputKnown + outputKnown;
  const inputPct =
    ioTotal > BigInt(0)
      ? Number((inputKnown * BigInt(1000)) / ioTotal) / 10
      : 0;
  const outputPct =
    ioTotal > BigInt(0) ? Math.max(0, Number((100 - inputPct).toFixed(1))) : 0;

  return (
    <section
      className="space-y-4"
      aria-label={m("overview")}
      data-component="AdminUsageMetrics"
    >
      <div className="grid gap-3 md:grid-cols-3">
        <NextMetricCard
          variant={NEXT_METRIC_VARIANTS.embedded}
          label={m("totalTokens")}
          value={summary.tokens.totalTokens.known}
          context={`${m("unknownInvocations")}: ${summary.tokens.totalTokens.unknownInvocations}`}
        />
        <NextMetricCard
          variant={NEXT_METRIC_VARIANTS.embedded}
          label={m("inputTokens")}
          value={summary.tokens.inputTokens.known}
          context={`${m("unknownInvocations")}: ${summary.tokens.inputTokens.unknownInvocations}`}
        />
        <NextMetricCard
          variant={NEXT_METRIC_VARIANTS.embedded}
          label={m("outputTokens")}
          value={summary.tokens.outputTokens.known}
          context={`${m("unknownInvocations")}: ${summary.tokens.outputTokens.unknownInvocations}`}
        />
      </div>

      {ioTotal > BigInt(0) ? (
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium text-foreground">
              {m("inputTokens")}:{" "}
              <span className="tabular-nums text-primary">{inputPct}%</span>
            </span>
            <span className="font-medium text-foreground">
              {m("outputTokens")}:{" "}
              <span className="tabular-nums text-status-info">{outputPct}%</span>
            </span>
          </div>
          <div
            className="mt-2 flex h-3 w-full overflow-hidden rounded-sm bg-muted"
            aria-hidden="true"
          >
            <div
              className="h-full bg-primary"
              style={{ width: `${inputPct}%` }}
            />
            <div
              className="h-full bg-status-info"
              style={{ width: `${outputPct}%` }}
            />
          </div>
        </div>
      ) : null}

      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {USAGE_SUMMARY_FIELDS.map((field) => (
          <div className="rounded-xl border border-border bg-card p-4" key={field}>
            <dt className="text-sm text-muted-foreground">{m(field)}</dt>
            <dd className="text-2xl font-semibold tabular-nums">
              {summary[field]}
            </dd>
          </div>
        ))}
      </dl>

      <div className="rounded-xl border border-border bg-card p-4">
        <h2 className="font-medium">{m("estimatedCost")}</h2>
        <p className="text-2xl font-semibold tabular-nums">
          {summary.estimatedCostUsd === null
            ? m("incomplete")
            : `$${summary.estimatedCostUsd}`}
        </p>
        <p className="text-sm text-muted-foreground">
          {m("knownSubtotal")}: ${summary.knownEstimatedCostUsd} ·{" "}
          {m("incompleteCostInvocations")}: {summary.incompleteCostInvocations}
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {USAGE_TOKEN_FIELDS.map((field) => (
          <div key={field} className="rounded-lg border border-border bg-card p-3">
            <dt className="text-sm text-muted-foreground">{m(field)}</dt>
            <dd className="font-medium tabular-nums">
              {summary.tokens[field].known}
            </dd>
            <dd className="text-xs text-muted-foreground">
              {m("unknownInvocations")}:{" "}
              {summary.tokens[field].unknownInvocations}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function safeBigInt(value: string | undefined): bigint {
  if (!value) return BigInt(0);
  try {
    return BigInt(value);
  } catch {
    return BigInt(0);
  }
}
