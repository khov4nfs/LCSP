import type { UsageMetricsProps } from "../../types/admin-usage.types";
import type { MessageKey } from "@lcsp/i18n";
import { resolveAppMessage } from "@/lib/i18n";
import {
  USAGE_SUMMARY_FIELDS,
  USAGE_TOKEN_FIELDS,
} from "../../config/admin-usage.config";
export function AdminUsageMetrics({ summary }: UsageMetricsProps) {
  const m = (key: string) =>
    resolveAppMessage(`pages.admin.usage.${key}` as MessageKey);
  return (
    <section className="space-y-4" aria-label={m("overview")}>
      <dl className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {USAGE_SUMMARY_FIELDS.map((field) => (
          <div className="rounded-xl border bg-card p-4" key={field}>
            <dt className="text-sm text-muted-foreground">{m(field)}</dt>
            <dd className="text-2xl tabular-nums">{summary[field]}</dd>
          </div>
        ))}
      </dl>
      <div className="rounded-xl border bg-card p-4">
        <h2 className="font-medium">{m("estimatedCost")}</h2>
        <p className="text-2xl tabular-nums">
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
          <div key={field} className="rounded-lg border p-3">
            <dt className="text-sm text-muted-foreground">{m(field)}</dt>
            <dd className="tabular-nums">{summary.tokens[field].known}</dd>
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
