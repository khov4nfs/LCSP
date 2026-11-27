import { BILLING_ORDER_STATUSES } from "@lcsp/contracts/billing";
import type { BillingOrderStatus } from "@lcsp/contracts/billing";
import type { MessageKey } from "@lcsp/i18n";

const BILLING_ORDER_BADGE_VARIANTS = {
  default: "default",
  secondary: "secondary",
  destructive: "destructive",
} as const;

export const BILLING_STATUS_TONES = {
  warning: "warning",
  success: "success",
  danger: "danger",
} as const;

export type BillingOrderBadgeVariant =
  (typeof BILLING_ORDER_BADGE_VARIANTS)[keyof typeof BILLING_ORDER_BADGE_VARIANTS];

export type BillingStatusTone =
  (typeof BILLING_STATUS_TONES)[keyof typeof BILLING_STATUS_TONES];

type BillingOrderPresentation = {
  messageKey: MessageKey;
  badgeVariant: BillingOrderBadgeVariant;
  tone: BillingStatusTone;
  showPendingPaymentHint: boolean;
  showPendingReconciliationAlert: boolean;
  isTerminal: boolean;
};

const BILLING_ORDER_PRESENTATIONS = {
  [BILLING_ORDER_STATUSES.PENDING_PAYMENT]: {
    messageKey: "pages.workspace.settingsHub.billing.statuses.pendingPayment",
    badgeVariant: BILLING_ORDER_BADGE_VARIANTS.secondary,
    tone: BILLING_STATUS_TONES.warning,
    showPendingPaymentHint: true,
    showPendingReconciliationAlert: false,
    isTerminal: false,
  },
  [BILLING_ORDER_STATUSES.CREDITED]: {
    messageKey: "pages.workspace.settingsHub.billing.statuses.credited",
    badgeVariant: BILLING_ORDER_BADGE_VARIANTS.default,
    tone: BILLING_STATUS_TONES.success,
    showPendingPaymentHint: false,
    showPendingReconciliationAlert: false,
    isTerminal: true,
  },
  [BILLING_ORDER_STATUSES.EXPIRED]: {
    messageKey: "pages.workspace.settingsHub.billing.statuses.expired",
    badgeVariant: BILLING_ORDER_BADGE_VARIANTS.destructive,
    tone: BILLING_STATUS_TONES.danger,
    showPendingPaymentHint: false,
    showPendingReconciliationAlert: false,
    isTerminal: true,
  },
  [BILLING_ORDER_STATUSES.CANCELLED]: {
    messageKey: "pages.workspace.settingsHub.billing.statuses.cancelled",
    badgeVariant: BILLING_ORDER_BADGE_VARIANTS.destructive,
    tone: BILLING_STATUS_TONES.danger,
    showPendingPaymentHint: false,
    showPendingReconciliationAlert: false,
    isTerminal: true,
  },
  [BILLING_ORDER_STATUSES.PENDING_RECONCILIATION]: {
    messageKey:
      "pages.workspace.settingsHub.billing.statuses.pendingReconciliation",
    badgeVariant: BILLING_ORDER_BADGE_VARIANTS.secondary,
    tone: BILLING_STATUS_TONES.warning,
    showPendingPaymentHint: false,
    showPendingReconciliationAlert: true,
    isTerminal: false,
  },
} satisfies Record<BillingOrderStatus, BillingOrderPresentation>;

/**
 * Business purpose: Map an authoritative backend billing order status to customer-facing presentation metadata.
 * Business rules:
 * - Every canonical BillingOrderStatus from @lcsp/contracts must map to a deterministic i18n key, semantic tone, and terminal flag.
 * - Pending states remain non-terminal so polling and manual status checks stay active until credited, expired, or cancelled.
 * Execution flow:
 * 1. Look up the status entry in BILLING_ORDER_PRESENTATIONS and return its presentation descriptor.
 * Failure cases:
 * - TypeScript exhaustiveness via satisfies Record<BillingOrderStatus, BillingOrderPresentation> prevents unmapped contract statuses.
 * Side effects:
 * - Pure read-only lookup; no mutations or network calls.
 */
export function getBillingOrderPresentation(status: BillingOrderStatus) {
  return BILLING_ORDER_PRESENTATIONS[status];
}
