import type { BillingAdminSummary } from "@lcsp/contracts/billing";
import { resolveAppMessage } from "@/lib/i18n";
import { getAppLocaleSnapshot } from "@/lib/locale";

type AdminBillingTrendCardProps = {
  trend: BillingAdminSummary["settledTopUpTrend"];
};

export function AdminBillingTrendCard({ trend }: AdminBillingTrendCardProps) {
  const maxAmount = trend.reduce(
    (max, item) =>
      BigInt(item.amountVnd) > max ? BigInt(item.amountVnd) : max,
    BigInt(0),
  );
  const locale = getAppLocaleSnapshot();

  return (
    <section className="min-h-60 rounded-xl border border-border bg-card p-5 shadow-xs">
      <h2 className="text-lg font-semibold text-foreground">
        {resolveAppMessage("pages.admin.billing.trend.title")}
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {resolveAppMessage("pages.admin.billing.trend.description")}
      </p>
      <div
        aria-label={resolveAppMessage("pages.admin.billing.trend.title")}
        className="mt-4 flex h-32 items-end justify-between gap-5 px-2"
        role="img"
      >
        {trend.map((item) => {
          const amount = BigInt(item.amountVnd);
          const height =
            maxAmount === BigInt(0)
              ? 3
              : Math.max(10, Number((amount * BigInt(135)) / maxAmount));
          const dayLabel = new Intl.DateTimeFormat(locale, {
            weekday: "short",
            timeZone: "UTC",
          }).format(new Date(`${item.day}T12:00:00.000Z`));
          const dayAriaLabel = resolveAppMessage(
            "pages.admin.billing.trend.dayAria",
          ).replace("{day}", dayLabel);

          return (
            <div
              key={item.day}
              aria-label={`${dayAriaLabel}: ${item.amountVnd}`}
              className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-3"
            >
              <div className="flex h-full w-full items-end justify-center">
                <div
                  className="-translate-y-2.5 w-11/12 rounded-md bg-primary"
                  style={{ height: `${height}%` }}
                />
              </div>
              <span className="text-xs text-muted-foreground">{dayLabel}</span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
