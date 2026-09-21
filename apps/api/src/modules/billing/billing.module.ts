import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { ConfigModule } from "@nestjs/config";
import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { BillingAccountingKernel } from "./application/shared/billing-accounting.kernel.js";
import { PrismaBillingTransaction } from "./infrastructure/persistence/prisma-billing-transaction.js";
import { BillingPaymentKernel } from "./application/shared/billing-payment.kernel.js";
import { BILLING_TRANSACTION_PORT } from "./domain/repositories/billing-transaction.port.js";
import { BillingUsageController } from "./presentation/http/billing-usage.controller.js";
import { BillingCustomerController } from "./presentation/http/billing-customer.controller.js";
import { SePayWebhookController } from "./presentation/http/sepay-webhook.controller.js";
import { BillingAdminReconciliationController } from "./presentation/http/billing-admin-reconciliation.controller.js";
import { BillingAdminReportingController } from "./presentation/http/billing-admin-reporting.controller.js";
import { SePayReconciliationConsumer } from "./infrastructure/messaging/sepay-reconciliation-consumer.js";
import { SePayWebhookIngress } from "./infrastructure/security/sepay-webhook-ingress.js";
import { OutboxModule } from "../../platform/outbox/outbox.module.js";
import { AcceptSePayWebhookHandler } from "./application/commands/accept-sepay-webhook/accept-sepay-webhook.handler.js";
import { ClaimBillingInvocationHandler } from "./application/commands/claim-billing-invocation/claim-billing-invocation.handler.js";
import { CreateBillingOrderHandler } from "./application/commands/create-billing-order/create-billing-order.handler.js";
import { RejectBillingPaymentHandler } from "./application/commands/reject-billing-payment/reject-billing-payment.handler.js";
import { ReleaseBillingReservationHandler } from "./application/commands/release-billing-reservation/release-billing-reservation.handler.js";
import { ResolveBillingPaymentHandler } from "./application/commands/resolve-billing-payment/resolve-billing-payment.handler.js";
import { ReserveBillingCreditsHandler } from "./application/commands/reserve-billing-credits/reserve-billing-credits.handler.js";
import { SettleBillingUsageHandler } from "./application/commands/settle-billing-usage/settle-billing-usage.handler.js";
import { ReconcileAcceptedSePayWebhookHandler } from "./application/commands/reconcile-accepted-sepay-webhook/reconcile-accepted-sepay-webhook.handler.js";
import { EstimateBillingHandler } from "./application/queries/estimate-billing/estimate-billing.handler.js";
import { EstimateUsageBillingHandler } from "./application/queries/estimate-usage-billing/estimate-usage-billing.handler.js";
import { GetBillingOrderHandler } from "./application/queries/get-billing-order/get-billing-order.handler.js";
import { GetBillingReconciliationHandler } from "./application/queries/get-billing-reconciliation/get-billing-reconciliation.handler.js";
import { GetBillingWalletHandler } from "./application/queries/get-billing-wallet/get-billing-wallet.handler.js";
import { ListBillingHistoryHandler } from "./application/queries/list-billing-history/list-billing-history.handler.js";
import { ListBillingReconciliationHandler } from "./application/queries/list-billing-reconciliation/list-billing-reconciliation.handler.js";
import { GetBillingRevenueSummaryHandler } from "./application/queries/get-billing-revenue-summary/get-billing-revenue-summary.handler.js";
import { ListBillingTransactionsHandler } from "./application/queries/list-billing-transactions/list-billing-transactions.handler.js";
import { ResolveBillingAssessmentOwnerHandler } from "./application/queries/resolve-billing-assessment-owner/resolve-billing-assessment-owner.handler.js";
import {
  BILLING_USAGE_KERNEL,
  BillingUsageKernel,
} from "./application/shared/billing-usage.kernel.js";

@Module({
  imports: [
    CqrsModule,
    ConfigModule.forRoot({ isGlobal: true }),
    RbacModule,
    OutboxModule,
  ],
  controllers: [
    BillingUsageController,
    BillingCustomerController,
    SePayWebhookController,
    BillingAdminReconciliationController,
    BillingAdminReportingController,
  ],
  providers: [
    PrismaService,
    PrismaBillingTransaction,
    {
      provide: BILLING_TRANSACTION_PORT,
      useExisting: PrismaBillingTransaction,
    },
    BillingAccountingKernel,
    BillingPaymentKernel,
    {
      provide: BILLING_USAGE_KERNEL,
      useClass: BillingUsageKernel,
    },
    SePayReconciliationConsumer,
    SePayWebhookIngress,
    AcceptSePayWebhookHandler,
    ClaimBillingInvocationHandler,
    CreateBillingOrderHandler,
    EstimateBillingHandler,
    EstimateUsageBillingHandler,
    GetBillingOrderHandler,
    GetBillingReconciliationHandler,
    GetBillingWalletHandler,
    ListBillingHistoryHandler,
    ListBillingReconciliationHandler,
    GetBillingRevenueSummaryHandler,
    ListBillingTransactionsHandler,
    RejectBillingPaymentHandler,
    ReleaseBillingReservationHandler,
    ResolveBillingAssessmentOwnerHandler,
    ResolveBillingPaymentHandler,
    ReserveBillingCreditsHandler,
    SettleBillingUsageHandler,
    ReconcileAcceptedSePayWebhookHandler,
  ],
  exports: [BillingAccountingKernel, BillingPaymentKernel],
})
export class BillingModule {}
