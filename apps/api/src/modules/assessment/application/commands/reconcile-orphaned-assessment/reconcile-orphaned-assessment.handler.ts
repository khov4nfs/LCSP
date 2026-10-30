import { HttpStatus } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  AGENT_EXECUTION_STATES,
  AGENTIC_RUNTIME_TRANSITION_GUARDS,
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { AssessmentAuditMode, Prisma } from "@prisma/client";

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

  /**
   * Business purpose: Cancel an owner’s abandoned Assessment only when repository setup stalled
   *   before any Root execution began.
   *
   * Business rules:
   * - The owner must match; only ACTIVE, never-started QUEUED runtime state with no lease,
   *   checkpoint, turn or runtime event is eligible.
   * - An already CANCELLED Assessment is an idempotent no-op; at least one stale repository
   *   scan must be failed before cancellation.
   *
   * Execution flow:
   * 1. Lock and load the Assessment and owner-bound runtime in one transaction.
   * 2. Verify that execution never started, then fail eligible stale repository scans.
   * 3. Cancel through the lifecycle coordinator and mark the runtime CANCELLED with its lease
   *   cleared.
   *
   * Failure cases:
   * - Missing ownership/runtime returns ASSESSMENT_NOT_FOUND; started or otherwise ineligible
   *   work and absent stale scans return the repository-setup state conflict.
   * - Transaction errors roll back scan, lifecycle and runtime changes together.
   *
   * Side effects:
   * - Persists stale scan failures, lifecycle/coordinator events and runtime cancellation
   *   within the caller-visible transaction.
   */
  execute(command: ReconcileOrphanedAssessmentCommand) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "Assessment" WHERE id=${command.assessmentId} FOR UPDATE`,
      );
      const assessment = await tx.assessment.findUnique({
        where: { id: command.assessmentId },
        include: { runtime: true, domainCase: true },
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
        assessment.domainCase?.auditMode === AssessmentAuditMode.CUSTOMER_SELECTED ||
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
