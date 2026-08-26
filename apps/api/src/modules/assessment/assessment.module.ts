import { Module } from "@nestjs/common";
import { CqrsModule } from "@nestjs/cqrs";

import { RbacModule } from "../../platform/rbac/rbac.module.js";
import { CreateAssessmentHandler } from "./application/commands/create-assessment/create-assessment.handler.js";
import { GetAssessmentHandler } from "./application/queries/get-assessment/get-assessment.handler.js";
import { ListAssessmentsHandler } from "./application/queries/list-assessments/list-assessments.handler.js";
import { ASSESSMENT_REPOSITORY } from "./application/ports/persistence/assessment.repository.js";
import { PrismaAssessmentRepository } from "./infrastructure/persistence/prisma-assessment.repository.js";
import { AssessmentController } from "./presentation/http/assessment.controller.js";

/**
 * Wires RBAC-protected assessment commands and queries to Prisma-backed persistence and HTTP endpoints.
 */
@Module({
  imports: [CqrsModule, RbacModule],
  controllers: [AssessmentController],
  providers: [
    CreateAssessmentHandler,
    GetAssessmentHandler,
    ListAssessmentsHandler,
    PrismaAssessmentRepository,
    {
      provide: ASSESSMENT_REPOSITORY,
      useExisting: PrismaAssessmentRepository,
    },
  ],
})
export class AssessmentModule {}
