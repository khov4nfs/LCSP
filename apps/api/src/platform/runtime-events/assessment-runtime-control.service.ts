import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_LIFECYCLE_STATES,
  ARTIFACT_LIFECYCLE_STATES,
  AGENT_EXECUTION_STATES,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_ROOT_BOUNDARY,
  ASSESSMENT_ROOT_COMMAND_TYPES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_REDACTION_STATUSES,
} from "@lcsp/contracts/audit";
import {
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS as Actions,
  isAssessmentRuntimeControlState,
  ASSESSMENT_RUNTIME_CONTROL_PROBLEM_CODES as Problems,
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
  type AssessmentRuntimeControlAction,
  type AssessmentRuntimeControlResult,
  type AssessmentRuntimeControlState,
} from "@lcsp/contracts/evidence";
import {
  buildOutboxMessageInput,
  OUTBOX_AGGREGATE_TYPES,
} from "@lcsp/contracts/outbox";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  AssessmentRuntimeControlState as DbState,
  Prisma,
} from "@prisma/client";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../http/filters/error.factory.js";
import { OutboxRepository } from "../outbox/outbox.repository.js";
import type { RbacRequestContext } from "../rbac/interfaces/rbac-request.interface.js";
import { AssessmentLifecycleCoordinator } from "../../modules/assessment/application/services/assessment-lifecycle-coordinator.service.js";

// Explicit persistence boundary; controllers never return Prisma values.
function toDb(state: AssessmentRuntimeControlState): DbState {
  return DbState[state];
}
function result(row: {
  id: string;
  state: string;
  requestId: string | null;
}): AssessmentRuntimeControlResult {
  if (!isAssessmentRuntimeControlState(row.state))
    throw new Error("Invalid persisted runtime control state");
  return { state: row.state, targetRunId: row.id, requestId: row.requestId };
}

@Injectable()
export class AssessmentRuntimeControlService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxRepository,
    private readonly lifecycle: AssessmentLifecycleCoordinator,
  ) {}

  async current(
    assessmentId: string,
  ): Promise<AssessmentRuntimeControlResult | null> {
    const runtime = await this.prisma.assessmentRuntime.findUnique({
      where: { assessmentId },
      select: {
        assessmentId: true,
        threadId: true,
        checkpointNamespace: true,
        currentExecutionId: true,
      },
    });
    if (!runtime || !runtime.currentExecutionId) return null;
    const row = await this.prisma.assessmentRuntimeTurn.findUnique({
      where: { id: runtime.currentExecutionId },
    });
    if (
      !row ||
      runtime.checkpointNamespace !== assessmentId ||
      row.assessmentId !== assessmentId ||
      row.threadId !== runtime.threadId
    ) {
      throw problemException(Problems.staleTarget, assessmentId, {
        status: HttpStatus.CONFLICT,
      });
    }
    return result(row);
  }

  /** CAS and outbox enqueue are atomic. Every retry stays bound to one run. */
  async request(input: {
    assessmentId: string;
    actor: RbacRequestContext;
    correlationId: string;
    action: AssessmentRuntimeControlAction;
    targetRunId?: string;
  }): Promise<AssessmentRuntimeControlResult> {
    const outcome = await this.prisma.$transaction(async (tx) => {
      const { runtime, row } = await this.loadCanonicalTarget(
        tx,
        input.assessmentId,
        input.correlationId,
        input.actor,
      );
      if (input.targetRunId && input.targetRunId !== row.id) {
        const target = await tx.assessmentRuntimeTurn.findUnique({
          where: { id: input.targetRunId },
        });
        if (
          target?.assessmentId === input.assessmentId &&
          target.threadId === runtime.threadId
        ) {
          // Completion wins a late Stop. A duplicate Continue may arrive after
          // its new native generation has already registered or completed.
          if (
            input.action === Actions.stop &&
            target.state === toDb(States.completed)
          )
            return { control: result(target), changed: false };
          if (
            input.action === Actions.resume &&
            target.state === toDb(States.resumeRequested) &&
            target.logicalRunId === row.logicalRunId
          )
            return { control: result(row), changed: false };
        }
        throw problemException(Problems.staleTarget, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      const stop = input.action === Actions.stop;
      const expected = stop ? States.running : States.stopped;
      const requested = stop ? States.stopRequested : States.resumeRequested;
      if (
        row.state === toDb(requested) ||
        (stop && row.state === toDb(States.stopped)) ||
        row.state === toDb(States.completed)
      ) {
        return { control: result(row), changed: false };
      }
      if (row.state !== toDb(expected)) {
        throw problemException(Problems.notStopped, input.correlationId, {
          status: HttpStatus.CONFLICT,
        });
      }
      if (row.boundary !== ASSESSMENT_ROOT_BOUNDARY) {
        throw problemException(
          ASSESSMENT_ERROR_CODES.repositorySetupStateInvalid,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      if (!stop) {
        const assessment = await tx.assessment.findUniqueOrThrow({
          where: { id: input.assessmentId },
          include: {
            runtime: true,
            domainCase: { include: { ruleSet: true } },
          },
        });
        const pins = assessment.domainCase;
        const snapshot = pins?.repositorySnapshotId
          ? await tx.repositorySnapshot.findUnique({
              where: { id: pins.repositorySnapshotId },
            })
          : null;
        if (
          assessment.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.PAUSED ||
          assessment.runtime?.executionState !==
            AGENT_EXECUTION_STATES.PAUSED ||
          !assessment.runtime.checkpointId ||
          !row.checkpointJson ||
          !pins?.ruleSetVersionId ||
          !pins.repositoryScanJobId ||
          !snapshot ||
          snapshot.assessmentId !== input.assessmentId ||
          snapshot.commitSha !== pins.repositoryCommit ||
          !pins.ruleSet ||
          ![
            ARTIFACT_LIFECYCLE_STATES.ACTIVE,
            ARTIFACT_LIFECYCLE_STATES.SUPERSEDED,
          ].some((state) => state === pins.ruleSet?.lifecycleState) ||
          (await tx.assessmentHumanRequest.count({
            where: {
              assessmentId: input.assessmentId,
              status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
            },
          }))
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.CHECKPOINT_INVALID,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
      }
      const requestId = randomUUID();
      const claimed = await tx.assessmentRuntimeTurn.updateMany({
        where: { id: row.id, state: toDb(expected) },
        data: { state: toDb(requested), requestId },
      });
      if (claimed.count === 0) {
        const latest = await tx.assessmentRuntimeTurn.findUniqueOrThrow({
          where: { id: row.id },
        });
        return { control: result(latest), changed: false };
      }
      // Stop is observed at the Root's next native checkpoint boundary. Resume is an
      // ordinary Root command on the server-owned thread, never an Interview continuation.
      if (!stop)
        await this.outbox.enqueue(
          buildOutboxMessageInput({
            aggregateType: OUTBOX_AGGREGATE_TYPES.assessment,
            aggregateId: input.assessmentId,
            assessmentId: input.assessmentId,
            eventType: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
            correlationId: input.correlationId,
            causationId: requestId,
            actor: { id: input.actor.userId, type: AUDIT_ACTOR_TYPES.user },
            result: ASSESSMENT_ROOT_COMMAND_TYPES.ROOT_REQUESTED,
            redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
            idempotencyKey: `root-resume:${row.id}:${requestId}`,
            payload: { assessmentId: input.assessmentId },
          }),
          tx,
        );
      return {
        control: { state: requested, targetRunId: row.id, requestId },
        changed: true,
      };
    });
    return outcome.control;
  }

  private async loadCanonicalTarget(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    correlationId: string,
    actor: RbacRequestContext,
  ) {
    const { assessment, runtime } =
      await this.lockCanonicalAssessmentAndRuntime(
        tx,
        assessmentId,
        correlationId,
      );
    if (
      actor.role !== AUTH_USER_ROLES.admin &&
      assessment.ownerId !== actor.userId
    ) {
      throw problemException(ASSESSMENT_ERROR_CODES.notFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }
    if (!runtime.currentExecutionId) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    const row = await tx.assessmentRuntimeTurn.findUnique({
      where: { id: runtime.currentExecutionId },
    });
    if (
      !row ||
      runtime.checkpointNamespace !== assessmentId ||
      row.assessmentId !== assessmentId ||
      row.threadId !== runtime.threadId
    ) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    return { runtime, row };
  }

  private async lockCanonicalAssessmentAndRuntime(
    tx: Prisma.TransactionClient,
    assessmentId: string,
    correlationId: string,
  ) {
    const assessmentRows = await tx.$queryRaw<
      Array<{ id: string; ownerId: string }>
    >(
      Prisma.sql`SELECT "id", "ownerId" FROM "Assessment"
        WHERE "id" = ${assessmentId} FOR UPDATE`,
    );
    if (!assessmentRows[0]) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    const runtimeRows = await tx.$queryRaw<Array<{ assessmentId: string }>>(
      Prisma.sql`SELECT "assessmentId" FROM "AssessmentRuntime"
        WHERE "assessmentId" = ${assessmentId} FOR UPDATE`,
    );
    if (!runtimeRows[0]) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    const runtime = await tx.assessmentRuntime.findUnique({
      where: { assessmentId },
      select: {
        assessmentId: true,
        threadId: true,
        checkpointNamespace: true,
        currentExecutionId: true,
      },
    });
    if (!runtime) {
      throw problemException(Problems.staleTarget, correlationId, {
        status: HttpStatus.CONFLICT,
      });
    }
    return { assessment: assessmentRows[0], runtime };
  }
}
