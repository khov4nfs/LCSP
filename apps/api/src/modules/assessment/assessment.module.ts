import { InternalAgentStreamController } from "./presentation/http/internal-agent-stream.controller.js";
import { PublishAgentStreamEventHandler } from "./application/commands/publish-agent-stream-event/publish-agent-stream-event.handler.js";
import { WorkspaceRuntimeEventsController } from "./presentation/http/workspace-runtime-events.controller.js";
import { GetWorkspaceRuntimeHandler } from "./application/queries/get-workspace-runtime/get-workspace-runtime.handler.js";
import { Module } from "@nestjs/common";
import { ASSESSMENT_RUNTIME_ERASURE } from "./application/ports/assessment-runtime-erasure.port.js";
import { AgentServerAssessmentErasure } from "./infrastructure/runtime/agent-server-assessment-erasure.js";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { CqrsModule } from "@nestjs/cqrs";
import { RuntimeWriteFenceInterceptor } from "../../platform/runtime-events/runtime-write-fence.interceptor.js";
import { StorageModule } from "../../platform/storage/storage.module.js";
import { AnswerHumanRequestHandler } from "./application/commands/answer-human-request/answer-human-request.handler.js";
import { GetHumanRequestsHandler } from "./application/queries/get-human-requests/get-human-requests.handler.js";
import { AssessmentHumanRequestSupport } from "./infrastructure/persistence/assessment-human-request-support.service.js";
import { LocalePresentationProjectionService } from "./infrastructure/presentation/locale-presentation-projection.service.js";
import { AssessmentDetailLoader } from "./infrastructure/persistence/assessment-detail.loader.js";
import { AssessmentReportLoader } from "./infrastructure/persistence/assessment-report.loader.js";
import { GetAssessmentReportHandler } from "./application/queries/get-assessment-report/get-assessment-report.handler.js";
import { AssessmentArtifactController } from "./presentation/http/assessment-artifact.controller.js";
import { AssessmentRepositorySetupLoader } from "./infrastructure/persistence/assessment-repository-setup.loader.js";
import { GetRepositorySetupHandler } from "./application/queries/get-repository-setup/get-repository-setup.handler.js";
import { GetRuntimeControlHandler } from "./application/queries/get-runtime-control/get-runtime-control.handler.js";
import { GetRootControlHandler } from "./application/queries/get-root-control/get-root-control.handler.js";
import { ControlAssessmentRuntimeHandler } from "./application/commands/control-assessment-runtime/control-assessment-runtime.handler.js";
import { AssessmentHumanResolutionController } from "./presentation/http/assessment-human-resolution.controller.js";
import { AssessmentProvenanceController } from "./presentation/http/assessment-provenance.controller.js";
import { AssessmentProvenanceLoader } from "./infrastructure/persistence/assessment-provenance.loader.js";

import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { AssessmentRuntimeControlService } from "../../platform/runtime-events/assessment-runtime-control.service.js";
import { AssessmentRuntimeEventService } from "../../platform/runtime-events/assessment-runtime-event.service.js";
import { AuditModule } from "../audit/audit.module.js";
import { BillingModule } from "../billing/billing.module.js";
import { ComplianceRuleSetModule } from "../compliance-rule-set/compliance-rule-set.module.js";
import { WorkerApiKeyGuard } from "../../common/guards/worker-api-key.guard.js";
import { AcceptAssessmentEvidenceHandler } from "./application/commands/accept-assessment-evidence/accept-assessment-evidence.handler.js";
import { AcceptAssessmentFactHandler } from "./application/commands/accept-assessment-fact/accept-assessment-fact.handler.js";
import { ClaimAssessmentRootHandler } from "./application/commands/claim-assessment-root/claim-assessment-root.handler.js";
import { CompleteRepositorySetupHandler } from "./application/commands/complete-repository-setup/complete-repository-setup.handler.js";
import { CreateAssessmentHandler } from "./application/commands/create-assessment/create-assessment.handler.js";
import { DeleteAssessmentHandler } from "./application/commands/delete-assessment/delete-assessment.handler.js";
import { FinishAssessmentRootHandler } from "./application/commands/finish-assessment-root/finish-assessment-root.handler.js";
import { HeartbeatAssessmentRootHandler } from "./application/commands/heartbeat-assessment-root/heartbeat-assessment-root.handler.js";
import { OpenHumanRequestHandler } from "./application/commands/open-human-request/open-human-request.handler.js";
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
import { ListAssessmentEventsHandler } from "./application/queries/list-assessment-events/list-assessment-events.handler.js";
import { GetAssessmentHandler } from "./application/queries/get-assessment/get-assessment.handler.js";
import { GetPinnedRuleSetHandler } from "./application/queries/get-pinned-rule-set/get-pinned-rule-set.handler.js";
import { GetRootContextHandler } from "./application/queries/get-root-context/get-root-context.handler.js";
import { ListAssessmentsHandler } from "./application/queries/list-assessments/list-assessments.handler.js";
import { AssessmentCompletionGate } from "./application/services/assessment-completion-gate.service.js";
import { AssessmentEventAppender } from "./application/services/assessment-event-appender.service.js";
import { AssessmentEvidenceInvalidation } from "./application/services/assessment-evidence-invalidation.service.js";
import { AssessmentLifecycleCoordinator } from "./application/services/assessment-lifecycle-coordinator.service.js";
import { AssessmentRuntimeAuthority } from "./application/services/assessment-runtime-authority.service.js";
import { AssessmentRuntimePreparation } from "./application/services/assessment-runtime-preparation.service.js";
import { PrismaAssessmentBillingRetention } from "./infrastructure/billing/prisma-assessment-billing-retention.js";
import { AssessmentCaseSupport } from "./infrastructure/persistence/assessment-case-support.service.js";
import { PrismaAssessmentRepository } from "./infrastructure/persistence/prisma-assessment.repository.js";
import { AssessmentDomainController } from "./presentation/http/assessment-domain.controller.js";
import { AssessmentRuntimeControlController } from "./presentation/http/assessment-runtime-control.controller.js";
import { AssessmentController } from "./presentation/http/assessment.controller.js";

/**
 * Wires RBAC-protected assessment commands and queries to Prisma-backed persistence and HTTP endpoints.
 */
@Module({
  imports: [
    CqrsModule,
    RbacModule,
    AuditModule,
    BillingModule,
    ComplianceRuleSetModule,
    StorageModule,
  ],
  controllers: [
    InternalAgentStreamController,
    AssessmentRuntimeControlController,
    AssessmentController,
    WorkspaceRuntimeEventsController,
    AssessmentDomainController,
    AssessmentHumanResolutionController,
    AssessmentArtifactController,
    AssessmentProvenanceController,
  ],
  providers: [
    { provide: APP_INTERCEPTOR, useClass: RuntimeWriteFenceInterceptor },
    PublishAgentStreamEventHandler,
    AssessmentRuntimeControlService,
    GetRuntimeControlHandler,
    GetRootControlHandler,
    ControlAssessmentRuntimeHandler,
    AssessmentLifecycleCoordinator,
    AssessmentEventAppender,
    AssessmentRuntimeAuthority,
    AssessmentRuntimePreparation,
    AssessmentCaseSupport,
    AssessmentEvidenceInvalidation,
    AssessmentCompletionGate,
    LocalePresentationProjectionService,
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
    GetPinnedRuleSetHandler,
    GetRootContextHandler,
    AssessmentRuntimeEventService,
    WorkerApiKeyGuard,
    CreateAssessmentHandler,
    TransitionAssessmentLifecycleHandler,
    CompleteRepositorySetupHandler,
    DeleteAssessmentHandler,
    AgentServerAssessmentErasure,
    {
      provide: ASSESSMENT_RUNTIME_ERASURE,
      useExisting: AgentServerAssessmentErasure,
    },
    RenameAssessmentHandler,
    GetAssessmentHandler,
    ListAssessmentEventsHandler,
    GetWorkspaceRuntimeHandler,
    AssessmentDetailLoader,
    AssessmentReportLoader,
    AssessmentProvenanceLoader,
    AssessmentRepositorySetupLoader,
    GetRepositorySetupHandler,
    GetAssessmentReportHandler,
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
