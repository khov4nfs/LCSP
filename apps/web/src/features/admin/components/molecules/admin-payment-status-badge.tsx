import {
  BILLING_ORDER_STATUSES,
  PAYMENT_RECONCILIATION_STATUSES,
  type BillingAdminPaymentRow,
} from "@lcsp/contracts/billing";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const ADMIN_PAYMENT_TONES = {
  success: "success",
  warning: "warning",
  danger: "danger",
} as const;

type AdminPaymentTone =
  (typeof ADMIN_PAYMENT_TONES)[keyof typeof ADMIN_PAYMENT_TONES];

const TONE_CLASSES: Record<AdminPaymentTone, string> = {
  [ADMIN_PAYMENT_TONES.success]:
    "border-status-success-border bg-status-success-bg text-status-success",
  [ADMIN_PAYMENT_TONES.warning]:
    "border-status-warning-border bg-status-warning-bg text-status-warning",
  [ADMIN_PAYMENT_TONES.danger]:
    "border-status-danger-border bg-status-danger-bg text-status-danger",
};

type AdminPaymentStatusBadgeProps = {
  label: string;
  reconciliationStatus: BillingAdminPaymentRow["reconciliationStatus"];
  orderStatus?: BillingAdminPaymentRow["order"] extends infer T
    ? T extends { status: infer S }
      ? S
      : never
    : never;
  mode: "webhook" | "order";
  className?: string;
};

/**
 * Business purpose: Resolve the semantic status tone for an admin payment webhook or order status badge.
 * Business rules:
 * - Matched webhooks and credited orders map to success tokens; duplicates, rejections, expired, or cancelled orders map to danger tokens; pending/unmatched/review states map to warning tokens.
 * Execution flow:
 * 1. Inspect either reconciliationStatus (webhook mode) or orderStatus + duplicate block (order mode) and return the matching AdminPaymentTone.
 * Failure cases:
 * - Unrecognized or missing order statuses default safely to warning so operators inspect them.
 * Side effects:
 * - Pure read-only helper.
 */
function resolveAdminPaymentTone({
  mode,
  reconciliationStatus,
  orderStatus,
}: Pick<
  AdminPaymentStatusBadgeProps,
  "mode" | "reconciliationStatus" | "orderStatus"
>): AdminPaymentTone {
  if (mode === "webhook") {
    if (reconciliationStatus === PAYMENT_RECONCILIATION_STATUSES.MATCHED) {
      return ADMIN_PAYMENT_TONES.success;
    }
    if (
      reconciliationStatus === PAYMENT_RECONCILIATION_STATUSES.DUPLICATE ||
      reconciliationStatus === PAYMENT_RECONCILIATION_STATUSES.REJECTED
    ) {
      return ADMIN_PAYMENT_TONES.danger;
    }
    return ADMIN_PAYMENT_TONES.warning;
  }

  if (reconciliationStatus === PAYMENT_RECONCILIATION_STATUSES.DUPLICATE) {
    return ADMIN_PAYMENT_TONES.danger;
  }
  if (orderStatus === BILLING_ORDER_STATUSES.CREDITED) {
    return ADMIN_PAYMENT_TONES.success;
  }
  if (
    orderStatus === BILLING_ORDER_STATUSES.EXPIRED ||
    orderStatus === BILLING_ORDER_STATUSES.CANCELLED
  ) {
    return ADMIN_PAYMENT_TONES.danger;
  }
  return ADMIN_PAYMENT_TONES.warning;
}

/**
 * Business purpose: Render an admin payment or webhook status badge using LCSP semantic status tokens aligned to Figma Status masters (1681:1297, 1681:1299, 1681:1301).
 * Business rules:
 * - Preserves localized label text supplied by the parent while applying consistent semantic success/warning/danger styling.
 * Execution flow:
 * 1. Compute semantic tone via resolveAdminPaymentTone.
 * 2. Render Badge with semantic status border, background, and foreground classes.
 * Failure cases:
 * - Exhaustive TONE_CLASSES mapping ensures every tone renders valid token classes.
 * Side effects:
 * - Pure presentational component.
 */
export function AdminPaymentStatusBadge({
  label,
  reconciliationStatus,
  orderStatus,
  mode,
  className,
}: AdminPaymentStatusBadgeProps) {
  const tone = resolveAdminPaymentTone({
    mode,
    reconciliationStatus,
    orderStatus,
  });

  return (
    <Badge
      variant="outline"
      className={cn("font-medium", TONE_CLASSES[tone], className)}
      data-component="AdminPaymentStatusBadge"
    >
      {label}
    </Badge>
  );
}
