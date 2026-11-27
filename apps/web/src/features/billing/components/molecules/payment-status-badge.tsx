import type { BillingOrderStatus } from "@lcsp/contracts/billing";
import type { Locale } from "@lcsp/contracts/shared";
import { resolveMessage } from "@lcsp/i18n";

import {
  STATUS_BADGE_TONES,
  StatusBadge,
  type StatusBadgeTone,
} from "@/components/atoms/status-badge";

import {
  BILLING_STATUS_TONES,
  getBillingOrderPresentation,
  type BillingStatusTone,
} from "../../utils/billing-order-presentation";

const STATUS_TONE_MAP: Record<BillingStatusTone, StatusBadgeTone> = {
  [BILLING_STATUS_TONES.success]: STATUS_BADGE_TONES.success,
  [BILLING_STATUS_TONES.warning]: STATUS_BADGE_TONES.warning,
  [BILLING_STATUS_TONES.danger]: STATUS_BADGE_TONES.danger,
};

type PaymentStatusBadgeProps = {
  locale: Locale;
  status: BillingOrderStatus;
  showDot?: boolean;
  className?: string;
};

/**
 * Business purpose: Render a billing order's authoritative payment status via the canonical StatusBadge atom.
 * Business rules:
 * - Credited orders render with success tokens, pending/reconciliation orders with warning tokens, and expired/cancelled orders with danger tokens.
 * - Labels resolve strictly through @lcsp/i18n from the contract status mapping.
 * Execution flow:
 * 1. Resolve presentation metadata from getBillingOrderPresentation(status).
 * 2. Delegate badge + optional dot rendering to shared StatusBadge.
 * Failure cases:
 * - Exhaustive STATUS_TONE_MAP guarantees every tone maps to a valid StatusBadgeTone.
 * Side effects:
 * - Pure presentational component.
 */
export function PaymentStatusBadge({
  locale,
  status,
  showDot = false,
  className,
}: PaymentStatusBadgeProps) {
  const presentation = getBillingOrderPresentation(status);

  return (
    <StatusBadge
      tone={STATUS_TONE_MAP[presentation.tone]}
      label={resolveMessage(locale, presentation.messageKey)}
      showDot={showDot}
      className={className}
    />
  );
}
