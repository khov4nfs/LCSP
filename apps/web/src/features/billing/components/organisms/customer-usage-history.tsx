import { resolveMessage } from "@lcsp/i18n";

import { Button } from "@/components/ui/button";

import type { CustomerUsageHistoryProps } from "../../types/customer-usage.types";
import { formatUsageCount } from "../../utils/customer-usage";
import { CustomerUsageHistoryRow } from "../molecules/customer-usage-history-row";

export function CustomerUsageHistory({
  locale,
  report,
  disabled,
  onPageChange,
}: CustomerUsageHistoryProps) {
  const pages = Math.max(1, Math.ceil(report.totalCount / report.pageSize));
  return (
    <section
      className="space-y-3"
      aria-labelledby="customer-usage-history-heading"
    >
      <h3 id="customer-usage-history-heading" className="font-semibold">
        {resolveMessage(locale, "pages.workspace.settingsHub.usage.history")}
      </h3>
      <ul className="space-y-3">
        {report.items.map((item) => (
          <li key={item.id}>
            <CustomerUsageHistoryRow locale={locale} item={item} />
          </li>
        ))}
      </ul>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {resolveMessage(locale, "pages.workspace.settingsHub.usage.page")
            .replace("{page}", String(report.page))
            .replace("{pages}", String(pages))
            .replace("{count}", formatUsageCount(report.totalCount, locale))}
        </p>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            disabled={disabled || report.page <= 1}
            onClick={() => onPageChange(report.page - 1)}
          >
            {resolveMessage(
              locale,
              "pages.workspace.settingsHub.usage.previous",
            )}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled || report.page >= pages}
            onClick={() => onPageChange(report.page + 1)}
          >
            {resolveMessage(locale, "pages.workspace.settingsHub.usage.next")}
          </Button>
        </div>
      </div>
    </section>
  );
}
