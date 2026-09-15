import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ORDER_STATUSES,
  BILLING_PAYMENT_PROVIDERS,
  PREPAID_BILLING_CONFIG,
} from "@lcsp/contracts/billing";
import type {
  BillingHistoryView,
  BillingOrderView,
  BillingWalletView,
  PrepaidEstimate,
} from "@lcsp/contracts/billing";
import {
  BillingOrderNotFoundError,
  InvalidBillingInputError,
} from "../../domain/billing.errors.js";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
  type OrderRecord,
} from "../../domain/repositories/billing-transaction.port.js";
import { Inject } from "@nestjs/common";
import { BillingPaymentService } from "./billing-payment.service.js";
import type { AppConfig } from "../../../../config/config.types.js";

@Injectable()
export class BillingCustomerService {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
    private readonly payments: BillingPaymentService,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  estimate(amountVnd: bigint): PrepaidEstimate {
    this.validateAmount(amountVnd);
    return {
      currency: PREPAID_BILLING_CONFIG.currency,
      amountVnd: amountVnd.toString(),
      creditUnits: (
        amountVnd * PREPAID_BILLING_CONFIG.creditUnitsPerVnd
      ).toString(),
      expiresInHours: PREPAID_BILLING_CONFIG.orderExpiryHours,
    };
  }

  async createOrder(
    userId: string,
    amountVnd: bigint,
    idempotencyKey: string,
    audit?: { correlationId: string; sessionId?: string },
  ) {
    const estimate = this.estimate(amountVnd);
    const order = await this.payments.createOrder({
      userId,
      idempotencyKey,
      amountMinorUnits: amountVnd,
      creditUnits: BigInt(estimate.creditUnits),
      actorId: userId,
      sessionId: audit?.sessionId,
      correlationId: audit?.correlationId,
    });
    return this.toOrderView(order);
  }

  async getWallet(userId: string): Promise<BillingWalletView> {
    const wallet = await this.transactions.runForUser(userId, (r) =>
      r.wallet.getOrCreateForUser(userId),
    );
    return {
      walletId: wallet.id,
      availableCredits: wallet.availableCredits.toString(),
      reservedCredits: wallet.reservedCredits.toString(),
      totalCredits: (
        wallet.availableCredits + wallet.reservedCredits
      ).toString(),
      version: wallet.version,
    };
  }

  async getOrder(
    userId: string,
    id: string,
    audit?: { correlationId: string; sessionId?: string },
  ): Promise<BillingOrderView> {
    const order = await this.transactions.runForUser(userId, (r) =>
      r.order.findForUser(userId, id),
    );
    if (!order) throw new BillingOrderNotFoundError("Billing order not found");
    return this.toOrderView(await this.expireIfNeeded(userId, order, audit));
  }

  async listHistory(
    userId: string,
    page = 1,
    pageSize = 20,
    audit?: { correlationId: string; sessionId?: string },
  ): Promise<BillingHistoryView> {
    const safePage = Number.isInteger(page) && page > 0 ? page : 1;
    const safePageSize =
      Number.isInteger(pageSize) && pageSize > 0 ? Math.min(pageSize, 100) : 20;
    const result = await this.transactions.runForUser(userId, (r) =>
      r.order.listForUser({
        userId,
        skip: (safePage - 1) * safePageSize,
        take: safePageSize,
      }),
    );
    return {
      orders: await Promise.all(
        result.orders.map(async (order) =>
          this.toOrderView(await this.expireIfNeeded(userId, order, audit)),
        ),
      ),
      page: safePage,
      pageSize: safePageSize,
      totalCount: result.totalCount,
    };
  }

  private validateAmount(amountVnd: bigint) {
    if (
      amountVnd < PREPAID_BILLING_CONFIG.minimumAmountVnd ||
      amountVnd > PREPAID_BILLING_CONFIG.maximumAmountVnd ||
      amountVnd % PREPAID_BILLING_CONFIG.amountStepVnd !== 0n
    )
      throw new InvalidBillingInputError("Invalid prepaid amount");
  }

  private async expireIfNeeded(
    userId: string,
    order: OrderRecord,
    audit?: { correlationId: string; sessionId?: string },
  ): Promise<OrderRecord> {
    if (
      order.status !== BILLING_ORDER_STATUSES.PENDING_PAYMENT ||
      !order.expiresAt ||
      order.expiresAt > new Date()
    )
      return order;
    await this.transactions.runForUser(userId, async (r) => {
      const claimed = await r.order.transition(
        order.id,
        BILLING_ORDER_STATUSES.PENDING_PAYMENT,
        BILLING_ORDER_STATUSES.EXPIRED,
      );
      if (claimed && audit) {
        await r.audit.append({
          eventType: BILLING_AUDIT_EVENT_TYPES.orderExpired,
          actorId: userId,
          sessionId: audit.sessionId,
          correlationId: audit.correlationId,
          resourceId: order.id,
          payload: { previousStatus: BILLING_ORDER_STATUSES.PENDING_PAYMENT },
        });
      }
    });
    return (
      (await this.transactions.runForUser(userId, (r) =>
        r.order.findForUser(userId, order.id),
      )) ?? order
    );
  }

  private toOrderView(order: OrderRecord): BillingOrderView {
    const amountVnd = order.amountMinorUnits.toString();
    const payment = this.config.getOrThrow<AppConfig["billing"]>("billing");
    const transferContent = order.paymentCode;
    return {
      id: order.id,
      amountVnd,
      creditUnits: order.creditUnits.toString(),
      paymentCode: order.paymentCode,
      status: order.status,
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
        transferContent,
        qrCodeUrl: payment.sePayQrUrlTemplate
          .replaceAll("{amountVnd}", encodeURIComponent(amountVnd))
          .replaceAll("{paymentCode}", encodeURIComponent(transferContent)),
      },
    };
  }
}
