"use client";
import { useState } from "react";
import {
  adminUsageQuerySchema,
  USAGE_ANALYTICS_DIMENSIONS,
  type AdminUsageQuery,
} from "@lcsp/contracts/billing";
import type { MessageKey } from "@lcsp/i18n";
import { resolveAppMessage } from "@/lib/i18n";
import { useAdminUsageQuery } from "@/lib/api/admin-usage-queries";
import { Button } from "@/components/ui/button";
import { AdminUsageFiltersForm } from "../molecules/admin-usage-filters";
import { AdminUsageMetrics } from "../molecules/admin-usage-metrics";
import { AdminUsageInvocations } from "./admin-usage-invocations";
import { AdminPagination } from "../molecules/admin-pagination";
import { USAGE_BREAKDOWN_COLUMNS } from "../../config/admin-usage.config";
import { toUsageQuery } from "../../schemas/admin-usage.schema";
export function AdminUsagePage() {
  const [query, setQuery] = useState<AdminUsageQuery>(() =>
    adminUsageQuerySchema.parse({}),
  );
  const [dimension, setDimension] = useState<string>(
    USAGE_ANALYTICS_DIMENSIONS.PROVIDER,
  );
  const { data, isLoading, isError, refetch } = useAdminUsageQuery(query);
  const m = (key: string) =>
    resolveAppMessage(`pages.admin.usage.${key}` as MessageKey);
  return (
    <div className="space-y-6" data-testid="admin-usage-page">
      <header>
        <h1 className="text-3xl font-semibold">{m("title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{m("description")}</p>
      </header>
      <AdminUsageFiltersForm
        onApply={(filters) =>
          setQuery(adminUsageQuerySchema.parse(toUsageQuery(filters)))
        }
      />
      {isLoading ? <p role="status">{m("loading")}</p> : null}
      {isError ? (
        <div role="alert">
          <p>{m("error")}</p>
          <Button onClick={() => void refetch()}>{m("retry")}</Button>
        </div>
      ) : null}
      {data && !isError ? (
        <>
          <AdminUsageMetrics summary={data.summary} />
          <section className="space-y-3">
            <label className="flex items-center gap-3">
              <span>{m("breakdown")}</span>
              <select
                aria-label={m("breakdown")}
                value={dimension}
                onChange={(e) => setDimension(e.target.value)}
                className="h-8 rounded-lg border bg-background px-2"
              >
                {Object.values(USAGE_ANALYTICS_DIMENSIONS).map((k) => (
                  <option key={k} value={k}>
                    {m(k)}
                  </option>
                ))}
              </select>
            </label>
            <div className="max-h-80 overflow-auto rounded-xl border">
              <table className="w-full text-left text-sm">
                <caption className="sr-only">{m("breakdown")}</caption>
                <thead>
                  <tr>
                    {USAGE_BREAKDOWN_COLUMNS.map((k) => (
                      <th className="p-3" key={k}>
                        {m(k)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.breakdowns
                    .filter((x) => x.dimension === dimension)
                    .map((x) => (
                      <tr key={x.key} className="border-t">
                        <td className="break-all p-3">
                          {dimension === USAGE_ANALYTICS_DIMENSIONS.STATUS
                            ? m(x.key)
                            : x.key}
                        </td>
                        <td className="p-3">{x.summary.calls}</td>
                        <td className="p-3">
                          {x.summary.tokens.totalTokens.known} (
                          {m("unknownInvocations")}:{" "}
                          {x.summary.tokens.totalTokens.unknownInvocations})
                        </td>
                        <td className="p-3">
                          ${x.summary.knownEstimatedCostUsd}
                        </td>
                        <td className="p-3">
                          {x.summary.incompleteCostInvocations}
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </section>
          <AdminUsageInvocations items={data.items} />
          <AdminPagination
            page={data.page}
            totalPages={Math.max(1, Math.ceil(data.totalCount / data.pageSize))}
            onPageChange={(page) => setQuery({ ...query, page })}
            disabled={isLoading}
          />
        </>
      ) : null}
    </div>
  );
}
