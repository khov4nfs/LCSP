import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AGENT_EXECUTION_STATES,
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { failStaleRepositoryScanJobs } from "../../../../../platform/scan/repository-scan-staleness.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { ReconcileOrphanedAssessmentCommand } from "./reconcile-orphaned-assessment.command.js";

@CommandHandler(ReconcileOrphanedAssessmentCommand)
export class ReconcileOrphanedAssessmentHandler implements ICommandHandler<ReconcileOrphanedAssessmentCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly lifecycle: AssessmentLifecycleCoordinator,
  ) {}

  execute(command: ReconcileOrphanedAssessmentCommand) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "Assessment" WHERE id=${command.assessmentId} FOR UPDATE`,
      );
      const assessment = await tx.assessment.findUnique({
        where: { id: command.assessmentId },
        include: { runtime: true },
      });
      const runtime = assessment?.runtime;
      if (!assessment || assessment.ownerId !== command.ownerId || !runtime) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.notFound,
          command.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      if (assessment.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.CANCELLED) {
        return {
          assessmentId: assessment.id,
          state: ASSESSMENT_LIFECYCLE_STATES.CANCELLED,
          reconciled: false,
        };
      }

      const hasRuntimeTurn =
        (await tx.assessmentRuntimeTurn.count({
          where: { assessmentId: assessment.id },
        })) > 0;
      const hasRuntimeEvent =
        (await tx.assessmentRuntimeEvent.count({
          where: { assessmentId: assessment.id },
        })) > 0;
      if (
        assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE ||
        assessment.lifecycleRevision === null ||
        runtime.executionState !== AGENT_EXECUTION_STATES.QUEUED ||
        runtime.currentExecutionId !== null ||
        runtime.leaseToken !== null ||
        runtime.leaseExpiresAt !== null ||
        runtime.checkpointId !== null ||
        hasRuntimeTurn ||
        hasRuntimeEvent
      ) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      const failedScanJobIds = await failStaleRepositoryScanJobs(tx, {
        assessmentId: assessment.id,
      });
      if (failedScanJobIds.length === 0) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
          command.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      await this.lifecycle.transitionVerifiedInTx(
        {
          assessmentId: assessment.id,
          expectedRevision: assessment.lifecycleRevision,
          toState: ASSESSMENT_LIFECYCLE_STATES.CANCELLED,
          actorId: command.ownerId,
          correlationId: command.correlationId,
        },
        tx,
        [
          AGENTIC_RUNTIME_TRANSITION_GUARDS.EXPLICIT_CANCELLATION_BEFORE_PUBLICATION,
        ],
        { id: command.ownerId, type: AUDIT_ACTOR_TYPES.user },
      );
      await tx.assessmentRuntime.update({
        where: { assessmentId: assessment.id },
        data: {
          executionState: AGENT_EXECUTION_STATES.CANCELLED,
          leaseToken: null,
          leaseExpiresAt: null,
        },
      });

      return {
        assessmentId: assessment.id,
        state: ASSESSMENT_LIFECYCLE_STATES.CANCELLED,
        reconciled: true,
      };
    });
  }
}
