import { Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { CqrsModule } from "@nestjs/cqrs";
import { RuntimeWriteFenceInterceptor } from "../../platform/runtime-events/runtime-write-fence.interceptor.js";
import { StorageModule } from "../../platform/storage/storage.module.js";
import { AnswerHumanRequestHandler } from "./application/commands/answer-human-request/answer-human-request.handler.js";
import { GetHumanRequestsHandler } from "./application/queries/get-human-requests/get-human-requests.handler.js";
import { AssessmentHumanRequestSupport } from "./infrastructure/persistence/assessment-human-request-support.service.js";
import { AssessmentHumanResolutionController } from "./presentation/http/assessment-human-resolution.controller.js";

import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { AssessmentRuntimeControlService } from "../../platform/runtime-events/assessment-runtime-control.service.js";
import { AssessmentRuntimeEventService } from "../../platform/runtime-events/assessment-runtime-event.service.js";
import { AuditModule } from "../audit/audit.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { LegalPortfolioModule } from "../legal-portfolio/legal-portfolio.module.js";
import { WorkerApiKeyGuard } from "../scan/presentation/http/worker-api-key.guard.js";
import { AcceptAssessmentEvidenceHandler } from "./application/commands/accept-assessment-evidence/accept-assessment-evidence.handler.js";
import { AcceptAssessmentFactHandler } from "./application/commands/accept-assessment-fact/accept-assessment-fact.handler.js";
import { ClaimAssessmentRootHandler } from "./application/commands/claim-assessment-root/claim-assessment-root.handler.js";
import { CompleteRepositorySetupHandler } from "./application/commands/complete-repository-setup/complete-repository-setup.handler.js";
import { CreateAssessmentHandler } from "./application/commands/create-assessment/create-assessment.handler.js";
import { DeleteAssessmentHandler } from "./application/commands/delete-assessment/delete-assessment.handler.js";
import { FinishAssessmentRootHandler } from "./application/commands/finish-assessment-root/finish-assessment-root.handler.js";
import { HeartbeatAssessmentRootHandler } from "./application/commands/heartbeat-assessment-root/heartbeat-assessment-root.handler.js";
import { MarkAiNotDetectedHandler } from "./application/commands/mark-ai-not-detected/mark-ai-not-detected.handler.js";
import { OpenHumanRequestHandler } from "./application/commands/open-human-request/open-human-request.handler.js";
import { PutRuleAssessmentHandler } from "./application/commands/put-rule-assessment/put-rule-assessment.handler.js";
import { RecordRootActivityHandler } from "./application/commands/record-root-activity/record-root-activity.handler.js";
import { RenameAssessmentHandler } from "./application/commands/rename-assessment/rename-assessment.handler.js";
import { ReportUnresolvableHumanFactHandler } from "./application/commands/report-unresolvable-human-fact/report-unresolvable-human-fact.handler.js";
import { RequestAssessmentFinalizationHandler } from "./application/commands/request-assessment-finalization/request-assessment-finalization.handler.js";
import { StartRuleInvestigationHandler } from "./application/commands/start-rule-investigation/start-rule-investigation.handler.js";
import { SubmitAssessmentFinalReportHandler } from "./application/commands/submit-assessment-final-report/submit-assessment-final-report.handler.js";
import { SubmitRuleDecisionHandler } from "./application/commands/submit-rule-decision/submit-rule-decision.handler.js";
import { TransitionAssessmentLifecycleHandler } from "./application/commands/transition-lifecycle/transition-lifecycle.handler.js";
import { ASSESSMENT_BILLING_RETENTION } from "./application/ports/billing/assessment-billing-retention.port.js";
import { ASSESSMENT_REPOSITORY } from "./application/ports/persistence/assessment.repository.js";
import { GetAssessmentReadinessHandler } from "./application/queries/get-assessment-readiness/get-assessment-readiness.handler.js";
import { GetAssessmentHandler } from "./application/queries/get-assessment/get-assessment.handler.js";
import { GetPinnedPortfolioHandler } from "./application/queries/get-pinned-portfolio/get-pinned-portfolio.handler.js";
import { GetRootContextHandler } from "./application/queries/get-root-context/get-root-context.handler.js";
import { ListAssessmentsHandler } from "./application/queries/list-assessments/list-assessments.handler.js";
import { ListRuleAssessmentsHandler } from "./application/queries/list-rule-assessments/list-rule-assessments.handler.js";
import { AssessmentCompletionGate } from "./application/services/assessment-completion-gate.service.js";
import { AssessmentEventAppender } from "./application/services/assessment-event-appender.service.js";
import { AssessmentEvidenceInvalidation } from "./application/services/assessment-evidence-invalidation.service.js";
import { AssessmentInterviewRuntimeService } from "./application/services/assessment-interview-runtime.service.js";
import { AssessmentInterviewSnippetService } from "./application/services/assessment-interview-snippet.service.js";
import { AssessmentLifecycleCoordinator } from "./application/services/assessment-lifecycle-coordinator.service.js";
import { AssessmentPipelineContinuationService } from "./application/services/assessment-pipeline-continuation.service.js";
import { AssessmentPipelineReconciliationService } from "./application/services/assessment-pipeline-reconciliation.service.js";
import { AssessmentRuntimeAuthority } from "./application/services/assessment-runtime-authority.service.js";
import { AssessmentRuntimePreparation } from "./application/services/assessment-runtime-preparation.service.js";
import { PrismaAssessmentBillingRetention } from "./infrastructure/billing/prisma-assessment-billing-retention.js";
import { AssessmentCaseSupport } from "./infrastructure/persistence/assessment-case-support.service.js";
import { PrismaAssessmentRepository } from "./infrastructure/persistence/prisma-assessment.repository.js";
import { AssessmentDomainController } from "./presentation/http/assessment-domain.controller.js";
import {
  AssessmentRuntimeControlController,
  InternalAssessmentRuntimeControlController,
} from "./presentation/http/assessment-runtime-control.controller.js";
import {
  AssessmentController,
  InternalAssessmentInterviewController,
  InternalRuleAssessmentController,
} from "./presentation/http/assessment.controller.js";

/**
 * Wires RBAC-protected assessment commands and queries to Prisma-backed persistence and HTTP endpoints.
 */
@Module({
  imports: [
    CqrsModule,
    RbacModule,
    AuditModule,
    BillingModule,
    LegalPortfolioModule,
    StorageModule,
  ],
  controllers: [
    AssessmentRuntimeControlController,
    InternalAssessmentRuntimeControlController,
    AssessmentController,
    InternalAssessmentInterviewController,
    InternalRuleAssessmentController,
    AssessmentDomainController,
    AssessmentHumanResolutionController,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RuntimeWriteFenceInterceptor },
    AssessmentRuntimeControlService,
    AssessmentInterviewRuntimeService,
    AssessmentInterviewSnippetService,
    AssessmentPipelineContinuationService,
    AssessmentPipelineReconciliationService,
    AssessmentLifecycleCoordinator,
    AssessmentEventAppender,
    AssessmentRuntimeAuthority,
    AssessmentRuntimePreparation,
    AssessmentCaseSupport,
    AssessmentEvidenceInvalidation,
    AssessmentCompletionGate,
    AssessmentHumanRequestSupport,
    AnswerHumanRequestHandler,
    GetHumanRequestsHandler,
    AcceptAssessmentEvidenceHandler,
    AcceptAssessmentFactHandler,
    ClaimAssessmentRootHandler,
    FinishAssessmentRootHandler,
    RequestAssessmentFinalizationHandler,
    SubmitAssessmentFinalReportHandler,
    HeartbeatAssessmentRootHandler,
    OpenHumanRequestHandler,
    ReportUnresolvableHumanFactHandler,
    RecordRootActivityHandler,
    StartRuleInvestigationHandler,
    SubmitRuleDecisionHandler,
    GetPinnedPortfolioHandler,
    GetRootContextHandler,
    AssessmentRuntimeEventService,
    WorkerApiKeyGuard,
    CreateAssessmentHandler,
    TransitionAssessmentLifecycleHandler,
    CompleteRepositorySetupHandler,
    DeleteAssessmentHandler,
    RenameAssessmentHandler,
    MarkAiNotDetectedHandler,
    PutRuleAssessmentHandler,
    ListRuleAssessmentsHandler,
    GetAssessmentHandler,
    GetAssessmentReadinessHandler,
    ListAssessmentsHandler,
    PrismaAssessmentRepository,
    {
      provide: ASSESSMENT_REPOSITORY,
      useExisting: PrismaAssessmentRepository,
    },
    PrismaAssessmentBillingRetention,
    {
      provide: ASSESSMENT_BILLING_RETENTION,
      useExisting: PrismaAssessmentBillingRetention,
    },
  ],
})
export class AssessmentModule {}
