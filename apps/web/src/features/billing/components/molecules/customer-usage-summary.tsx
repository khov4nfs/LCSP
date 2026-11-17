import { resolveMessage } from "@lcsp/i18n";

import { Card, CardContent } from "@/components/ui/card";

import {
  CUSTOMER_USAGE_LABELS,
  CUSTOMER_USAGE_SUMMARY_FIELDS,
  CUSTOMER_USAGE_VISIBLE_TOKENS,
} from "../../config/customer-usage.config";
import type { CustomerUsageSummaryProps } from "../../types/customer-usage.types";
import { formatUsageCount } from "../../utils/customer-usage";

export function CustomerUsageSummary({
  summary,
  sellingPrice,
  locale,
}: CustomerUsageSummaryProps) {
  return (
    <div className="space-y-4" data-component="CustomerUsageSummary">
      <div className="grid gap-3 sm:grid-cols-2">
        {CUSTOMER_USAGE_SUMMARY_FIELDS.map((field) => (
          <Card key={field} className="min-w-0">
            <CardContent>
              <dl>
                <dt className="text-sm text-muted-foreground">
                  {resolveMessage(locale, CUSTOMER_USAGE_LABELS[field])}
                </dt>
                <dd className="wrap-anywhere text-xl font-semibold tabular-nums">
                  {formatUsageCount(summary[field], locale)}
                </dd>
              </dl>
            </CardContent>
          </Card>
        ))}
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        {CUSTOMER_USAGE_VISIBLE_TOKENS.map((field) => {
          const metric = summary.tokens[field];
          return (
            <Card key={field} className="min-w-0">
              <CardContent>
                <dl>
                  <dt className="text-sm text-muted-foreground">
                    {resolveMessage(locale, CUSTOMER_USAGE_LABELS[field])}
                  </dt>
                  <dd className="wrap-anywhere text-lg font-semibold tabular-nums">
                    {metric.unknownInvocations === summary.calls &&
                    summary.calls > 0
                      ? resolveMessage(
                          locale,
                          "pages.workspace.settingsHub.usage.unknown",
                        )
                      : formatUsageCount(metric.known, locale)}
                  </dd>
                  <dd className="mt-1 text-xs text-muted-foreground">
                    {resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.usage.unknownInvocations",
                    )}
                    : {formatUsageCount(metric.unknownInvocations, locale)}
                  </dd>
                </dl>
              </CardContent>
            </Card>
          );
        })}
      </div>
      <Card data-component="CustomerUsageSellingPrice">
        <CardContent>
          <dl className="space-y-2">
            <dt className="text-sm text-muted-foreground">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.usage.sellingPrice",
              )}
            </dt>
            <dd className="wrap-anywhere text-xl font-semibold tabular-nums">
              {sellingPrice.estimatedTotalUsd ??
                resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.usage.partialCost",
                )}
            </dd>
            <dt className="text-sm">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.usage.knownSubtotal",
              )}
            </dt>
            <dd className="wrap-anywhere tabular-nums">
              {sellingPrice.knownSubtotalUsd}
            </dd>
          </dl>
          <p className="mt-2 text-xs text-muted-foreground">
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.usage.sellingPriceNotice",
            ).replace("{multiplier}", sellingPrice.multiplier)}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardContent>
          <dl className="space-y-2">
            <div>
              <dt className="text-sm text-muted-foreground">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.usage.estimatedCost",
                )}
              </dt>
              <dd className="wrap-anywhere text-xl font-semibold tabular-nums">
                {summary.estimatedCostUsd ??
                  resolveMessage(
                    locale,
                    "pages.workspace.settingsHub.usage.partialCost",
                  )}
              </dd>
            </div>
            <div>
              <dt className="inline text-sm">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.usage.knownSubtotal",
                )}
                :{" "}
              </dt>
              <dd className="inline wrap-anywhere tabular-nums">
                {summary.knownEstimatedCostUsd}
              </dd>
            </div>
            <div>
              <dt className="inline text-sm">
                {resolveMessage(
                  locale,
                  "pages.workspace.settingsHub.usage.incompleteCostInvocations",
                )}
                :{" "}
              </dt>
              <dd className="inline tabular-nums">
                {formatUsageCount(summary.incompleteCostInvocations, locale)}
              </dd>
            </div>
          </dl>
        </CardContent>
      </Card>
    </div>
  );
}
