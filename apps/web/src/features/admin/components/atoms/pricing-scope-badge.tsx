import {
  AlertTriangleIcon,
  GlobeIcon,
  LayersIcon,
  TargetIcon,
} from "lucide-react";
import {
  MODEL_PRICING_SCOPES,
  type ModelPricingScope,
} from "@lcsp/contracts/billing";
import { Badge } from "@/components/ui/badge";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import { PRICING_SCOPE_LABEL_KEYS } from "../../config/admin-pricing.config";

type PricingScopeBadgeProps = {
  scope: ModelPricingScope | null;
  className?: string;
};

/**
 * Displays the resolved tariff scope (`EXACT_MODEL`, `PROVIDER_DEFAULT`, `GLOBAL_DEFAULT`)
 * or an explicit coverage-gap indicator with semantic color, border, and icon.
 */
export function PricingScopeBadge({
  scope,
  className,
}: PricingScopeBadgeProps) {
  if (scope === null) {
    return (
      <Badge
        variant="destructive"
        className={cn(
          "rounded-sm border border-admin-danger-border bg-admin-danger-surface text-admin-danger-foreground",
          className,
        )}
      >
        <AlertTriangleIcon aria-hidden="true" />
        <span>{resolveAppMessage("pages.admin.pricing.labels.coverageGap")}</span>
      </Badge>
    );
  }

  const label = resolveAppMessage(PRICING_SCOPE_LABEL_KEYS[scope]);

  if (scope === MODEL_PRICING_SCOPES.exactModel) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "rounded-sm border-admin-status-active-border bg-admin-status-active-surface text-admin-status-active-foreground",
          className,
        )}
      >
        <TargetIcon aria-hidden="true" />
        <span>{label}</span>
      </Badge>
    );
  }

  if (scope === MODEL_PRICING_SCOPES.providerDefault) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "rounded-sm border-admin-warning-border bg-admin-warning-surface text-admin-warning-foreground",
          className,
        )}
      >
        <LayersIcon aria-hidden="true" />
        <span>{label}</span>
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className={cn("rounded-sm border border-border", className)}
    >
      <GlobeIcon aria-hidden="true" />
      <span>{label}</span>
    </Badge>
  );
}
