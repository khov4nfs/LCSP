import type { ConfigService } from "@nestjs/config";
import {
  BILLING_ORDER_STATUSES,
  BILLING_PAYMENT_PROVIDERS,
} from "@lcsp/contracts/billing";
import type {
  BillingOrderStatus,
  BillingOrderView,
} from "@lcsp/contracts/billing";
import type { OrderRecord } from "../../domain/repositories/billing-transaction.port.js";
import type { AppConfig } from "../../../../config/config.types.js";

export function toBillingOrderView(
  order: OrderRecord,
  config: ConfigService<AppConfig, true>,
): BillingOrderView {
  const amountVnd = order.amountMinorUnits.toString();
  const payment = config.getOrThrow<AppConfig["billing"]>("billing");
  return {
    id: order.id,
    amountVnd,
    creditUnits: order.creditUnits.toString(),
    paymentCode: order.paymentCode,
    status: toBillingOrderStatus(order.status),
    expiresAt: order.expiresAt?.toISOString() ?? null,
    creditedAt: order.creditedAt?.toISOString() ?? null,
    createdAt: order.createdAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
    paymentInstructions: {
      provider: BILLING_PAYMENT_PROVIDERS.sepay,
      currency: "VND",
      paymentCode: order.paymentCode,
      amountVnd,
      bankName: payment.sePayBankName,
      bankAccountNumber: payment.sePayBankAccountNumber,
      accountHolder: payment.sePayAccountHolder,
      transferContent: order.paymentCode,
      qrCodeUrl: payment.sePayQrUrlTemplate
        .replaceAll("{amountVnd}", encodeURIComponent(amountVnd))
        .replaceAll("{paymentCode}", encodeURIComponent(order.paymentCode)),
    },
  };
}

function toBillingOrderStatus(status: string): BillingOrderStatus {
  if (
    Object.values(BILLING_ORDER_STATUSES).includes(status as BillingOrderStatus)
  ) {
    return status as BillingOrderStatus;
  }
  throw new Error("Unsupported persisted billing order status");
}
