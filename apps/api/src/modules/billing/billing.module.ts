import { Module } from "@nestjs/common";
import { ConfigModule } from "@nestjs/config";
import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { BillingAccountingService } from "./application/services/billing-accounting.service.js";
import { PrismaBillingTransaction } from "./infrastructure/persistence/prisma-billing-transaction.js";
import { BillingPaymentService } from "./application/services/billing-payment.service.js";
import { BillingUsageService } from "./application/services/billing-usage.service.js";
import { BILLING_TRANSACTION_PORT } from "./domain/repositories/billing-transaction.port.js";
import { BillingEstimateService } from "./application/services/billing-estimate.service.js";
import { BillingUsageController } from "./presentation/http/billing-usage.controller.js";
import { BillingCustomerController } from "./presentation/http/billing-customer.controller.js";
import { BillingCustomerService } from "./application/services/billing-customer.service.js";
import { SePayWebhookIngressService } from "./application/services/sepay-webhook-ingress.service.js";
import { SePayWebhookController } from "./presentation/http/sepay-webhook.controller.js";
import { BillingAdminReconciliationController } from "./presentation/http/billing-admin-reconciliation.controller.js";
import { BillingAdminReconciliationService } from "./application/services/billing-admin-reconciliation.service.js";
import { SePayReconciliationConsumerService } from "./application/services/sepay-reconciliation-consumer.service.js";
import { OutboxModule } from "../../platform/outbox/outbox.module.js";

@Module({
  imports: [ConfigModule.forRoot({ isGlobal: true }), RbacModule, OutboxModule],
  controllers: [
    BillingUsageController,
    BillingCustomerController,
    SePayWebhookController,
    BillingAdminReconciliationController,
  ],
  providers: [
    PrismaService,
    PrismaBillingTransaction,
    {
      provide: BILLING_TRANSACTION_PORT,
      useExisting: PrismaBillingTransaction,
    },
    BillingAccountingService,
    BillingPaymentService,
    BillingUsageService,
    BillingEstimateService,
    BillingCustomerService,
    SePayWebhookIngressService,
    BillingAdminReconciliationService,
    SePayReconciliationConsumerService,
  ],
  exports: [
    BillingAccountingService,
    BillingPaymentService,
    BillingUsageService,
    BillingEstimateService,
  ],
})
export class BillingModule {}
