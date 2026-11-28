import { EyeIcon, LockIcon } from "lucide-react";
import { MODEL_USAGE_DEBIT_MODES } from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";
import { Badge } from "@/components/ui/badge";
import { formatLocaleDateTimeWithYear } from "@/lib/date-format";
import { resolveAppMessage } from "@/lib/i18n";
import { PRICING_DEBIT_MODE_LABEL_KEYS } from "../../config/admin-pricing.config";

type AdminPricingPostureBannerProps = {
  debitMode:
    | typeof MODEL_USAGE_DEBIT_MODES.OFF
    | typeof MODEL_USAGE_DEBIT_MODES.SHADOW;
  dbUtcNow: string;
  locale: Locale;
};

/**
 * Surfaces the live `MODEL_USAGE_DEBIT` safety posture, database UTC clock anchor,
 * and Phase B2 read-only inspection boundary without using an assertive `role="alert"`.
 */
export function AdminPricingPostureBanner({
  debitMode,
  dbUtcNow,
  locale,
}: AdminPricingPostureBannerProps) {
  const debitModeText = resolveAppMessage(
    PRICING_DEBIT_MODE_LABEL_KEYS[debitMode],
  );

  return (
    <section
      aria-label={resolveAppMessage("pages.admin.pricing.postureBannerAria")}
      className="flex flex-col gap-3 rounded-md border border-border bg-card p-4 sm:flex-row sm:items-center sm:justify-between"
    >
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant="outline"
            className="rounded-sm border-admin-warning-border bg-admin-warning-surface font-mono text-admin-warning-foreground"
            data-testid="pricing-debit-mode-badge"
          >
            <LockIcon aria-hidden="true" />
            <span>
              {resolveAppMessage("pages.admin.pricing.debitModeLabel")}=
              {debitMode}
            </span>
          </Badge>
          <Badge variant="secondary" className="rounded-sm border border-border">
            <EyeIcon aria-hidden="true" />
            <span>{resolveAppMessage("pages.admin.pricing.readOnlyBadge")}</span>
          </Badge>
          <span className="text-xs font-medium text-foreground">
            {debitModeText}
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          {resolveAppMessage("pages.admin.pricing.readOnlyNotice")}
        </p>
      </div>
      <div className="shrink-0 rounded-sm border border-border bg-muted/60 px-3 py-2 text-xs">
        <div className="font-medium text-muted-foreground">
          {resolveAppMessage("pages.admin.pricing.dbUtcNowLabel")}
        </div>
        <div
          className="font-mono text-foreground tabular-nums"
          data-testid="pricing-db-utc-now"
        >
          {formatLocaleDateTimeWithYear(dbUtcNow, locale)} ({dbUtcNow})
        </div>
      </div>
    </section>
  );
}
