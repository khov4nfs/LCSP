import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { AuditModule } from "../audit/audit.module.js";
import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { AssessmentRuntimeEventService } from "../../platform/runtime-events/assessment-runtime-event.service.js";
import { WorkerApiKeyGuard } from "../scan/presentation/http/worker-api-key.guard.js";
import { CreateAssessmentHandler } from "./application/commands/create-assessment/create-assessment.handler.js";
import { CompleteRepositorySetupHandler } from "./application/commands/complete-repository-setup/complete-repository-setup.handler.js";
import { GetAssessmentHandler } from "./application/queries/get-assessment/get-assessment.handler.js";
import { GetAssessmentReadinessHandler } from "./application/queries/get-assessment-readiness/get-assessment-readiness.handler.js";
import { AssessmentInterviewRuntimeService } from "./application/services/assessment-interview-runtime.service.js";
import { ListAssessmentsHandler } from "./application/queries/list-assessments/list-assessments.handler.js";
import { ASSESSMENT_REPOSITORY } from "./application/ports/persistence/assessment.repository.js";
import { PrismaAssessmentRepository } from "./infrastructure/persistence/prisma-assessment.repository.js";
import {
  AssessmentController,
  InternalAssessmentInterviewController,
} from "./presentation/http/assessment.controller.js";

/**
 * Wires RBAC-protected assessment commands and queries to Prisma-backed persistence and HTTP endpoints.
 */
@Module({
  imports: [CqrsModule, RbacModule, AuditModule],
  controllers: [AssessmentController, InternalAssessmentInterviewController],
  providers: [
    AssessmentInterviewRuntimeService,
    AssessmentRuntimeEventService,
    WorkerApiKeyGuard,
    CreateAssessmentHandler,
    CompleteRepositorySetupHandler,
    GetAssessmentHandler,
    GetAssessmentReadinessHandler,
    ListAssessmentsHandler,
    PrismaAssessmentRepository,
    {
      provide: ASSESSMENT_REPOSITORY,
      useExisting: PrismaAssessmentRepository,
    },
  ],
})
export class AssessmentModule {}
