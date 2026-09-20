import { BILLING_ORDER_STATUSES } from "@lcsp/contracts/billing";
import type { BillingOrderStatus } from "@lcsp/contracts/billing";
import type { MessageKey } from "@lcsp/i18n";

const BILLING_ORDER_BADGE_VARIANTS = {
  default: "default",
  secondary: "secondary",
  destructive: "destructive",
} as const;

type BillingOrderBadgeVariant =
  (typeof BILLING_ORDER_BADGE_VARIANTS)[keyof typeof BILLING_ORDER_BADGE_VARIANTS];

type BillingOrderPresentation = {
  messageKey: MessageKey;
  badgeVariant: BillingOrderBadgeVariant;
  showPendingPaymentHint: boolean;
  showPendingReconciliationAlert: boolean;
  isTerminal: boolean;
};

const BILLING_ORDER_PRESENTATIONS = {
  [BILLING_ORDER_STATUSES.PENDING_PAYMENT]: {
    messageKey: "pages.workspace.settingsHub.billing.statuses.pendingPayment",
    badgeVariant: BILLING_ORDER_BADGE_VARIANTS.secondary,
    showPendingPaymentHint: true,
    showPendingReconciliationAlert: false,
    isTerminal: false,
  },
  [BILLING_ORDER_STATUSES.CREDITED]: {
    messageKey: "pages.workspace.settingsHub.billing.statuses.credited",
    badgeVariant: BILLING_ORDER_BADGE_VARIANTS.default,
    showPendingPaymentHint: false,
    showPendingReconciliationAlert: false,
    isTerminal: true,
  },
  [BILLING_ORDER_STATUSES.EXPIRED]: {
    messageKey: "pages.workspace.settingsHub.billing.statuses.expired",
    badgeVariant: BILLING_ORDER_BADGE_VARIANTS.destructive,
    showPendingPaymentHint: false,
    showPendingReconciliationAlert: false,
    isTerminal: true,
  },
  [BILLING_ORDER_STATUSES.CANCELLED]: {
    messageKey: "pages.workspace.settingsHub.billing.statuses.cancelled",
    badgeVariant: BILLING_ORDER_BADGE_VARIANTS.destructive,
    showPendingPaymentHint: false,
    showPendingReconciliationAlert: false,
    isTerminal: true,
  },
  [BILLING_ORDER_STATUSES.PENDING_RECONCILIATION]: {
    messageKey:
      "pages.workspace.settingsHub.billing.statuses.pendingReconciliation",
    badgeVariant: BILLING_ORDER_BADGE_VARIANTS.secondary,
    showPendingPaymentHint: false,
    showPendingReconciliationAlert: true,
    isTerminal: false,
  },
} satisfies Record<BillingOrderStatus, BillingOrderPresentation>;

export function getBillingOrderPresentation(status: BillingOrderStatus) {
  return BILLING_ORDER_PRESENTATIONS[status];
}
