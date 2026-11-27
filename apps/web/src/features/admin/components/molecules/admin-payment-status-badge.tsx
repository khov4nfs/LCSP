import {
  BILLING_ORDER_STATUSES,
  PAYMENT_RECONCILIATION_STATUSES,
  type BillingAdminPaymentRow,
} from "@lcsp/contracts/billing";

import {
  STATUS_BADGE_TONES,
  StatusBadge,
  type StatusBadgeTone,
} from "@/components/atoms/status-badge";

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
 * Business purpose: Resolve the semantic StatusBadge tone for an admin payment webhook or order status.
 * Business rules:
 * - Matched webhooks and credited orders map to success; duplicates, rejections, expired, or cancelled orders map to danger; pending/unmatched/review states map to warning.
 * Execution flow:
 * 1. Inspect either reconciliationStatus (webhook mode) or orderStatus + duplicate block (order mode) and return StatusBadgeTone.
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
>): StatusBadgeTone {
  if (mode === "webhook") {
    if (reconciliationStatus === PAYMENT_RECONCILIATION_STATUSES.MATCHED) {
      return STATUS_BADGE_TONES.success;
    }
    if (
      reconciliationStatus === PAYMENT_RECONCILIATION_STATUSES.DUPLICATE ||
      reconciliationStatus === PAYMENT_RECONCILIATION_STATUSES.REJECTED
    ) {
      return STATUS_BADGE_TONES.danger;
    }
    return STATUS_BADGE_TONES.warning;
  }

  if (reconciliationStatus === PAYMENT_RECONCILIATION_STATUSES.DUPLICATE) {
    return STATUS_BADGE_TONES.danger;
  }
  if (orderStatus === BILLING_ORDER_STATUSES.CREDITED) {
    return STATUS_BADGE_TONES.success;
  }
  if (
    orderStatus === BILLING_ORDER_STATUSES.EXPIRED ||
    orderStatus === BILLING_ORDER_STATUSES.CANCELLED
  ) {
    return STATUS_BADGE_TONES.danger;
  }
  return STATUS_BADGE_TONES.warning;
}

/**
 * Business purpose: Render an admin payment or webhook status badge via the canonical StatusBadge atom.
 * Business rules:
 * - Preserves localized label text supplied by the parent while applying shared StatusBadge semantic tokens.
 * Execution flow:
 * 1. Compute semantic tone via resolveAdminPaymentTone.
 * 2. Delegate rendering to shared StatusBadge.
 * Failure cases:
 * - Exhaustive StatusBadgeTone mapping ensures valid token classes.
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
  return (
    <StatusBadge
      tone={resolveAdminPaymentTone({
        mode,
        reconciliationStatus,
        orderStatus,
      })}
      label={label}
      className={className}
    />
  );
}
