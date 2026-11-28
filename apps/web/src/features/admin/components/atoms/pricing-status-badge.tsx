import {
  ArchiveIcon,
  BanIcon,
  CheckCircle2Icon,
  ClockIcon,
  FileEditIcon,
  LockIcon,
} from "lucide-react";
import {
  CUSTOMER_TARIFF_DRAFT_STATUSES,
  PRICING_ASSIGNMENT_STATUSES,
  type CustomerTariffDraftStatus,
  type PricingAssignmentStatus,
} from "@lcsp/contracts/billing";
import { Badge } from "@/components/ui/badge";
import { resolveAppMessage } from "@/lib/i18n";
import { cn } from "@/lib/utils";
import {
  PRICING_ASSIGNMENT_STATUS_LABEL_KEYS,
  PRICING_DRAFT_STATUS_LABEL_KEYS,
} from "../../config/admin-pricing.config";

type PricingAssignmentStatusBadgeProps = {
  status: PricingAssignmentStatus;
  className?: string;
};

export function PricingAssignmentStatusBadge({
  status,
  className,
}: PricingAssignmentStatusBadgeProps) {
  const label = resolveAppMessage(PRICING_ASSIGNMENT_STATUS_LABEL_KEYS[status]);

  if (status === PRICING_ASSIGNMENT_STATUSES.active) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "rounded-sm border-admin-status-active-border bg-admin-status-active-surface text-admin-status-active-foreground",
          className,
        )}
      >
        <CheckCircle2Icon aria-hidden="true" />
        <span>{label}</span>
      </Badge>
    );
  }

  if (status === PRICING_ASSIGNMENT_STATUSES.scheduled) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "rounded-sm border-admin-warning-border bg-admin-warning-surface text-admin-warning-foreground",
          className,
        )}
      >
        <ClockIcon aria-hidden="true" />
        <span>{label}</span>
      </Badge>
    );
  }

  return (
    <Badge
      variant="secondary"
      className={cn("rounded-sm border border-border", className)}
    >
      <ArchiveIcon aria-hidden="true" />
      <span>{label}</span>
    </Badge>
  );
}

type PricingDraftStatusBadgeProps = {
  status: CustomerTariffDraftStatus;
  className?: string;
};

export function PricingDraftStatusBadge({
  status,
  className,
}: PricingDraftStatusBadgeProps) {
  const label = resolveAppMessage(PRICING_DRAFT_STATUS_LABEL_KEYS[status]);

  if (status === CUSTOMER_TARIFF_DRAFT_STATUSES.draft) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "rounded-sm border-admin-warning-border bg-admin-warning-surface text-admin-warning-foreground",
          className,
        )}
      >
        <FileEditIcon aria-hidden="true" />
        <span>{label}</span>
      </Badge>
    );
  }

  if (status === CUSTOMER_TARIFF_DRAFT_STATUSES.published) {
    return (
      <Badge
        variant="outline"
        className={cn(
          "rounded-sm border-admin-status-active-border bg-admin-status-active-surface text-admin-status-active-foreground",
          className,
        )}
      >
        <LockIcon aria-hidden="true" />
        <span>{label}</span>
      </Badge>
    );
  }

  return (
    <Badge
      variant="destructive"
      className={cn(
        "rounded-sm border border-admin-danger-border bg-admin-danger-surface text-admin-danger-foreground",
        className,
      )}
    >
      <BanIcon aria-hidden="true" />
      <span>{label}</span>
    </Badge>
  );
}
