import { resolveMessage } from "@lcsp/i18n";

import { Card, CardContent } from "@/components/ui/card";

import {
  CUSTOMER_USAGE_COST_LABELS,
  CUSTOMER_USAGE_STATUS_LABELS,
  CUSTOMER_USAGE_VISIBLE_TOKENS,
  CUSTOMER_USAGE_LABELS,
} from "../../config/customer-usage.config";
import type { CustomerUsageHistoryRowProps } from "../../types/customer-usage.types";
import {
  formatUsageCount,
  formatUsageDateTime,
} from "../../utils/customer-usage";

export function CustomerUsageHistoryRow({
  locale,
  item,
}: CustomerUsageHistoryRowProps) {
  return (
    <Card className="min-w-0">
      <CardContent>
        <dl className="grid gap-2 text-sm sm:grid-cols-2">
          <div>
            <dt className="text-muted-foreground">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.usage.occurredAt",
              )}
            </dt>
            <dd>
              <time dateTime={item.occurredAt}>
                {formatUsageDateTime(item.occurredAt, locale)}
              </time>
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.usage.status",
              )}
            </dt>
            <dd>
              {resolveMessage(
                locale,
                item.attemptStatus
                  ? CUSTOMER_USAGE_STATUS_LABELS[item.attemptStatus]
                  : "pages.workspace.settingsHub.usage.unknown",
              )}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.usage.provider",
              )}
            </dt>
            <dd className="wrap-anywhere">{item.provider}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.usage.model",
              )}
            </dt>
            <dd className="wrap-anywhere">{item.model}</dd>
          </div>
          {CUSTOMER_USAGE_VISIBLE_TOKENS.map((field) => (
            <div key={field}>
              <dt className="text-muted-foreground">
                {resolveMessage(locale, CUSTOMER_USAGE_LABELS[field])}
              </dt>
              <dd className="wrap-anywhere tabular-nums">
                {item.tokens[field] === null
                  ? resolveMessage(
                      locale,
                      "pages.workspace.settingsHub.usage.unknown",
                    )
                  : formatUsageCount(item.tokens[field], locale)}
              </dd>
            </div>
          ))}
          <div>
            <dt className="text-muted-foreground">
              {resolveMessage(
                locale,
                "pages.workspace.settingsHub.usage.estimatedCost",
              )}
            </dt>
            <dd className="wrap-anywhere tabular-nums">
              {item.referenceCost?.estimatedCostUsd ??
                resolveMessage(
                  locale,
                  item.referenceCost
                    ? CUSTOMER_USAGE_COST_LABELS[item.referenceCost.status]
                    : "pages.workspace.settingsHub.usage.unknown",
                )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
