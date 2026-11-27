import type { BillingOrderStatus } from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";
import { resolveMessage } from "@lcsp/i18n";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import {
  BILLING_STATUS_TONES,
  getBillingOrderPresentation,
  type BillingStatusTone,
} from "../../utils/billing-order-presentation";

const TONE_BADGE_CLASSES: Record<BillingStatusTone, string> = {
  [BILLING_STATUS_TONES.success]:
    "border-status-success-border bg-status-success-bg text-status-success",
  [BILLING_STATUS_TONES.warning]:
    "border-status-warning-border bg-status-warning-bg text-status-warning",
  [BILLING_STATUS_TONES.danger]:
    "border-status-danger-border bg-status-danger-bg text-status-danger",
};

const TONE_DOT_CLASSES: Record<BillingStatusTone, string> = {
  [BILLING_STATUS_TONES.success]: "bg-status-success",
  [BILLING_STATUS_TONES.warning]: "bg-status-warning",
  [BILLING_STATUS_TONES.danger]: "bg-status-danger",
};

type PaymentStatusBadgeProps = {
  locale: Locale;
  status: BillingOrderStatus;
  showDot?: boolean;
  className?: string;
};

/**
 * Business purpose: Render a billing order's authoritative payment status with semantic status tokens aligned to Figma Status masters.
 * Business rules:
 * - Credited orders render with success tokens, pending/reconciliation orders with warning tokens, and expired/cancelled orders with danger tokens.
 * - Labels resolve strictly through @lcsp/i18n from the contract status mapping.
 * Execution flow:
 * 1. Resolve presentation metadata from getBillingOrderPresentation(status).
 * 2. Render Badge with semantic status classes and an optional 8px transaction state dot.
 * Failure cases:
 * - Exhaustive Record<BillingStatusTone, string> guarantees every tone resolves to valid CSS token classes.
 * Side effects:
 * - Pure presentational component; no network or storage side effects.
 */
export function PaymentStatusBadge({
  locale,
  status,
  showDot = false,
  className,
}: PaymentStatusBadgeProps) {
  const presentation = getBillingOrderPresentation(status);

  return (
    <Badge
      variant={presentation.badgeVariant}
      className={cn(
        "gap-1.5 border font-medium",
        TONE_BADGE_CLASSES[presentation.tone],
        className,
      )}
      data-component="PaymentStatusBadge"
    >
      {showDot ? (
        <span
          aria-hidden="true"
          className={cn("size-2 shrink-0 rounded-full", TONE_DOT_CLASSES[presentation.tone])}
        />
      ) : null}
      {resolveMessage(locale, presentation.messageKey)}
    </Badge>
  );
}
