import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";
import { ConfigModule, ConfigService } from "@nestjs/config";
import type { AppConfig } from "../../config/config.types.js";
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
import { BillingAdminController } from "./presentation/http/billing-admin.controller.js";
import { SePayReconciliationConsumer } from "./infrastructure/messaging/sepay-reconciliation-consumer.js";
import { SePayWebhookIngress } from "./infrastructure/security/sepay-webhook-ingress.js";
import { OutboxModule } from "../../platform/outbox/outbox.module.js";
import { AcceptSePayWebhookHandler } from "./application/commands/accept-sepay-webhook/accept-sepay-webhook.handler.js";
import { CreateBillingOrderHandler } from "./application/commands/create-billing-order/create-billing-order.handler.js";
import { ExpireBillingOrderHandler } from "./application/commands/expire-billing-order/expire-billing-order.handler.js";
import { RejectBillingPaymentHandler } from "./application/commands/reject-billing-payment/reject-billing-payment.handler.js";
import { ResolveBillingPaymentHandler } from "./application/commands/resolve-billing-payment/resolve-billing-payment.handler.js";
import { RecordLlmUsageHandler } from "./application/commands/record-llm-usage/record-llm-usage.handler.js";
import { ReconcileAcceptedSePayWebhookHandler } from "./application/commands/reconcile-accepted-sepay-webhook/reconcile-accepted-sepay-webhook.handler.js";
import { EstimateBillingHandler } from "./application/queries/estimate-billing/estimate-billing.handler.js";
import { GetBillingOrderHandler } from "./application/queries/get-billing-order/get-billing-order.handler.js";
import { GetBillingReconciliationHandler } from "./application/queries/get-billing-reconciliation/get-billing-reconciliation.handler.js";
import { GetBillingWalletHandler } from "./application/queries/get-billing-wallet/get-billing-wallet.handler.js";
import { ListBillingHistoryHandler } from "./application/queries/list-billing-history/list-billing-history.handler.js";
import { ListBillingReconciliationHandler } from "./application/queries/list-billing-reconciliation/list-billing-reconciliation.handler.js";
import { GetBillingRevenueSummaryHandler } from "./application/queries/get-billing-revenue-summary/get-billing-revenue-summary.handler.js";
import { ListBillingTransactionsHandler } from "./application/queries/list-billing-transactions/list-billing-transactions.handler.js";
import { ResolveBillingAssessmentOwnerHandler } from "./application/queries/resolve-billing-assessment-owner/resolve-billing-assessment-owner.handler.js";
import { GetBillingAdminDashboardHandler } from "./application/queries/get-admin-billing-dashboard/get-admin-billing-dashboard.handler.js";
import { GetBillingAdminExportHandler } from "./application/queries/get-admin-billing-export/get-admin-billing-export.handler.js";
import {
  BILLING_USAGE_KERNEL,
  BillingUsageKernel,
} from "./application/shared/billing-usage.kernel.js";
import { BillingCutoverService } from "./application/shared/billing-cutover.service.js";

import { AdminUsageController } from "./presentation/http/admin-usage.controller.js";
import { GetAdminUsageHandler } from "./application/queries/get-admin-usage/get-admin-usage.handler.js";
import { UsageAnalyticsReader } from "./application/shared/usage-analytics.reader.js";
import { GetCustomerUsageHandler } from "./application/queries/get-customer-usage/get-customer-usage.handler.js";
import { AuditModule } from "../../platform/audit/audit.module.js";
import { BillingAdminPricingController } from "./presentation/http/billing-admin-pricing.controller.js";
import { BillingAdmissionController } from "./presentation/http/billing-admission.controller.js";
import { BillingSettlementController } from "./presentation/http/billing-settlement.controller.js";
import { BillingInternalReconciliationController } from "./presentation/http/billing-internal-reconciliation.controller.js";
import { MODEL_PRICING_REPOSITORY } from "./domain/repositories/model-pricing.port.js";
import { PrismaModelPricingRepository } from "./infrastructure/persistence/prisma-model-pricing.repository.js";
import { RuntimeModelAllowlistService } from "./application/shared/runtime-model-allowlist.service.js";
import { ModelPricingCalculatorService } from "./application/shared/model-pricing-calculator.service.js";
import { CreateModelTariffDraftHandler } from "./application/commands/create-model-tariff-draft/create-model-tariff-draft.handler.js";
import { PublishModelTariffDraftHandler } from "./application/commands/publish-model-tariff-draft/publish-model-tariff-draft.handler.js";
import { SupersedeModelTariffAssignmentHandler } from "./application/commands/supersede-model-tariff-assignment/supersede-model-tariff-assignment.handler.js";
import { UpdateModelTariffDraftHandler } from "./application/commands/update-model-tariff-draft/update-model-tariff-draft.handler.js";
import { RequestBillableInvocationAdmissionHandler } from "./application/commands/request-billable-invocation-admission/request-billable-invocation-admission.handler.js";
import { ConsumeBillableInvocationAdmissionHandler } from "./application/commands/consume-billable-invocation-admission/consume-billable-invocation-admission.handler.js";
import { HeartbeatBillableInvocationAdmissionHandler } from "./application/commands/heartbeat-billable-invocation-admission/heartbeat-billable-invocation-admission.handler.js";
import { CancelBillableInvocationAdmissionHandler } from "./application/commands/cancel-billable-invocation-admission/cancel-billable-invocation-admission.handler.js";
import { SettleBillableInvocationUsageHandler } from "./application/commands/settle-billable-invocation-usage/settle-billable-invocation-usage.handler.js";
import { SweepExpiredInvocationLeasesHandler } from "./application/commands/sweep-expired-invocation-leases/sweep-expired-invocation-leases.handler.js";
import { CompensateBillingDebitHandler } from "./application/commands/compensate-billing-debit/compensate-billing-debit.handler.js";
import { BillingReconciliationSweeperService } from "./infrastructure/scheduling/billing-reconciliation-sweeper.service.js";
import { ResolveBillableInvocationNoUsageHandler } from "./application/commands/resolve-billable-invocation-no-usage/resolve-billable-invocation-no-usage.handler.js";
import { DecideBillingReconciliationCaseHandler } from "./application/commands/decide-billing-reconciliation-case/decide-billing-reconciliation-case.handler.js";
import { ListBillingReconciliationCasesHandler } from "./application/queries/list-billing-reconciliation-cases/list-billing-reconciliation-cases.handler.js";
import { GetBillingReconciliationCaseDetailHandler } from "./application/queries/get-billing-reconciliation-case-detail/get-billing-reconciliation-case-detail.handler.js";
import { GetModelPricingOverviewHandler } from "./application/queries/get-model-pricing-overview/get-model-pricing-overview.handler.js";
import { GetModelTariffDraftHandler } from "./application/queries/get-model-tariff-draft/get-model-tariff-draft.handler.js";
import { GetModelTariffSnapshotHandler } from "./application/queries/get-model-tariff-snapshot/get-model-tariff-snapshot.handler.js";
import { PreviewModelPricingHandler } from "./application/queries/preview-model-pricing/preview-model-pricing.handler.js";
import { ReconciliationArtifactService } from "./application/shared/reconciliation-artifact.service.js";
import { BillingRolloutAuthorityService } from "./application/shared/billing-rollout-authority.service.js";
import { CustomerUsageController } from "./presentation/http/customer-usage.controller.js";

@Module({
  imports: [
    CqrsModule,
    ConfigModule.forRoot({ isGlobal: true }),
    RbacModule,
    AuditModule,
    OutboxModule,
  ],
  controllers: [
    BillingUsageController,
    AdminUsageController,
    CustomerUsageController,
    BillingCustomerController,
    SePayWebhookController,
    BillingAdminReconciliationController,
    BillingAdminReportingController,
    BillingAdminController,
    BillingAdminPricingController,
    BillingAdmissionController,
    BillingSettlementController,
    BillingInternalReconciliationController,
  ],
  providers: [
    PrismaService,
    GetAdminUsageHandler,
    UsageAnalyticsReader,
    GetCustomerUsageHandler,
    PrismaBillingTransaction,
    {
      provide: BILLING_TRANSACTION_PORT,
      useExisting: PrismaBillingTransaction,
    },
    PrismaModelPricingRepository,
    {
      provide: MODEL_PRICING_REPOSITORY,
      useExisting: PrismaModelPricingRepository,
    },
    RuntimeModelAllowlistService,
    ModelPricingCalculatorService,
    CreateModelTariffDraftHandler,
    PublishModelTariffDraftHandler,
    SupersedeModelTariffAssignmentHandler,
    UpdateModelTariffDraftHandler,
    RequestBillableInvocationAdmissionHandler,
    ConsumeBillableInvocationAdmissionHandler,
    HeartbeatBillableInvocationAdmissionHandler,
    CancelBillableInvocationAdmissionHandler,
    SettleBillableInvocationUsageHandler,
    SweepExpiredInvocationLeasesHandler,
    CompensateBillingDebitHandler,
    BillingReconciliationSweeperService,
    ResolveBillableInvocationNoUsageHandler,
    DecideBillingReconciliationCaseHandler,
    ListBillingReconciliationCasesHandler,
    GetBillingReconciliationCaseDetailHandler,
    GetModelPricingOverviewHandler,
    GetModelTariffDraftHandler,
    GetModelTariffSnapshotHandler,
    PreviewModelPricingHandler,
    BillingAccountingKernel,
    BillingPaymentKernel,
    BillingCutoverService,
    {
      provide: BILLING_USAGE_KERNEL,
      useFactory: (
        transactions: PrismaBillingTransaction,
        prisma: PrismaService,
        configService?: ConfigService<AppConfig, true>,
      ) => new BillingUsageKernel(transactions, prisma, configService),
      inject: [
        BILLING_TRANSACTION_PORT,
        PrismaService,
        { token: ConfigService, optional: true },
      ],
    },
    SePayReconciliationConsumer,
    SePayWebhookIngress,
    AcceptSePayWebhookHandler,
    CreateBillingOrderHandler,
    ExpireBillingOrderHandler,
    EstimateBillingHandler,
    GetBillingOrderHandler,
    GetBillingAdminDashboardHandler,
    GetBillingAdminExportHandler,
    GetBillingReconciliationHandler,
    GetBillingWalletHandler,
    ListBillingHistoryHandler,
    ListBillingReconciliationHandler,
    GetBillingRevenueSummaryHandler,
    ListBillingTransactionsHandler,
    RejectBillingPaymentHandler,
    ResolveBillingAssessmentOwnerHandler,
    ResolveBillingPaymentHandler,
    RecordLlmUsageHandler,
    ReconcileAcceptedSePayWebhookHandler,
    ReconciliationArtifactService,
    BillingRolloutAuthorityService,
  ],
  exports: [
    BillingAccountingKernel,
    BillingPaymentKernel,
    BillingCutoverService,
    ReconciliationArtifactService,
    BillingRolloutAuthorityService,
  ],
})
export class BillingModule {}
