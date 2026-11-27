"use client";

import {
  BILLING_ADMIN_GATEWAYS,
  type BillingAdminPaymentRow,
} from "@lcsp/contracts/billing";

import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { AdminPaymentStatusBadge } from "../molecules/admin-payment-status-badge";

type PaymentInvestigationDialogProps = {
  payment: BillingAdminPaymentRow | null;
  closeLabel: string;
  description: string;
  labels: {
    customer: string;
    amount: string;
    credits: string;
    webhook: string;
    status: string;
    gateway: string;
  };
  unknownAccountLabel: string;
  sepayNameLabel: string;
  formatVnd: (amount: string | undefined) => string;
  getWebhookStatusLabel: (item: BillingAdminPaymentRow) => string;
  getOrderStatusLabel: (item: BillingAdminPaymentRow) => string;
  onClose: () => void;
};

/**
 * Business purpose: Present admin-only payment investigation details for a selected webhook/order record without exposing raw webhook secrets.
 * Business rules:
 * - Displays only safe projected fields (paymentCode/providerTransactionId, customer email, VND amount, credits, webhook status, order status, gateway).
 * - Never renders rawBody, signature, webhookSecret, or sanitizedPayload.
 * Execution flow:
 * 1. Control Dialog open state from payment !== null.
 * 2. Render header with payment reference + AdminPaymentStatusBadge and body with 6 PaymentDetail fields.
 * Failure cases:
 * - Null payment renders a closed dialog without side effects.
 * Side effects:
 * - Calls onClose when dismissed via close button, backdrop, or Escape key.
 */
export function PaymentInvestigationDialog({
  payment,
  closeLabel,
  description,
  labels,
  unknownAccountLabel,
  sepayNameLabel,
  formatVnd,
  getWebhookStatusLabel,
  getOrderStatusLabel,
  onClose,
}: PaymentInvestigationDialogProps) {
  return (
    <Dialog
      open={payment !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent
        closeLabel={closeLabel}
        data-component="PaymentInvestigationDialog"
      >
        {payment ? (
          <>
            <DialogHeader>
              <div className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <DialogTitle>
                    {payment.order?.paymentCode ??
                      payment.providerTransactionId}
                  </DialogTitle>
                  <AdminPaymentStatusBadge
                    mode="webhook"
                    label={getWebhookStatusLabel(payment)}
                    reconciliationStatus={payment.reconciliationStatus}
                  />
                </div>
                <DialogDescription>{description}</DialogDescription>
              </div>
            </DialogHeader>
            <DialogBody className="grid grid-cols-2 gap-4 text-sm">
              <PaymentDetail
                label={labels.customer}
                value={payment.account?.email ?? unknownAccountLabel}
              />
              <PaymentDetail
                label={labels.amount}
                value={formatVnd(payment.amountVnd)}
              />
              <PaymentDetail
                label={labels.credits}
                value={
                  payment.order?.creditUnits
                    ? formatVnd(payment.order.creditUnits)
                    : "\u2014"
                }
              />
              <PaymentDetail
                label={labels.webhook}
                value={getWebhookStatusLabel(payment)}
              />
              <PaymentDetail
                label={labels.status}
                value={getOrderStatusLabel(payment)}
              />
              <PaymentDetail
                label={labels.gateway}
                value={
                  payment.provider === BILLING_ADMIN_GATEWAYS.sepay
                    ? sepayNameLabel
                    : payment.provider
                }
              />
            </DialogBody>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function PaymentDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 space-y-1">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="wrap-break-word font-medium text-foreground tabular-nums">
        {value}
      </div>
    </div>
  );
}
