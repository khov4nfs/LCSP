import type { Prisma } from "@prisma/client";
import type { BillingAdminPaymentRow } from "@lcsp/contracts/billing";

export const BILLING_ADMIN_PAYMENT_RELATIONS = {
  user: { select: { id: true, email: true, displayName: true } },
  billingOrder: {
    select: {
      id: true,
      paymentCode: true,
      status: true,
      creditUnits: true,
      user: { select: { id: true, email: true, displayName: true } },
    },
  },
} satisfies Prisma.PaymentTransactionInclude;

export type BillingAdminPaymentRecord = Prisma.PaymentTransactionGetPayload<{
  include: typeof BILLING_ADMIN_PAYMENT_RELATIONS;
}>;

export function toBillingAdminPaymentRow(
  payment: BillingAdminPaymentRecord,
): BillingAdminPaymentRow {
  const account = payment.billingOrder?.user ?? payment.user ?? null;
  return {
    id: payment.id,
    provider: payment.provider,
    providerTransactionId: payment.providerTransactionId,
    amountVnd: payment.amountMinorUnits.toString(),
    reconciliationStatus: payment.reconciliationStatus,
    reconciliationReason: payment.reconciliationReason,
    receivedAt: payment.receivedAt.toISOString(),
    reconciledAt: payment.reconciledAt?.toISOString() ?? null,
    account: account
      ? {
          userId: account.id,
          email: account.email,
          displayName: account.displayName,
        }
      : null,
    order: payment.billingOrder
      ? {
          id: payment.billingOrder.id,
          paymentCode: payment.billingOrder.paymentCode,
          status: payment.billingOrder.status,
          creditUnits: payment.billingOrder.creditUnits.toString(),
        }
      : null,
  };
}
