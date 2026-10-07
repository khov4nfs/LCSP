import { randomUUID } from "node:crypto";

import {
  AGENT_EXECUTION_STATES,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  BLOCKER_REASONS,
  HUMAN_RESOLUTION_REQUEST_STATUSES,
  assessmentBlockerSchema,
  type AgentExecutionState,
  type BlockerReason,
} from "@lcsp/contracts/assessment";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  ASSESSMENT_DOMAIN_LIMITS,
  type AssessmentRootClaim,
} from "@lcsp/contracts/assessment-domain";
import { AUDIT_ACTOR_IDS, AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { HttpStatus, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/http/filters/error.factory.js";
import { AssessmentEventAppender } from "./assessment-event-appender.service.js";

export interface AuthorizedRootRun {
  assessmentId: string;
  threadId: string;
  executionId: string;
  lifecycleState: string;
  lifecycleRevision: number;
  blockerReason: BlockerReason | null;
  blockerReference: Prisma.JsonValue | null;
}

const ROOT_ACTOR = {
  id: AUDIT_ACTOR_IDS.assessmentRootAgent,
  type: AUDIT_ACTOR_TYPES.service,
} as const;

/**
 * Server-owned Root run authority. An agent can never name its own assessment, thread,
 * execution or lease: the API issues them at claim time and every governed tool call must
 * present the lease, which is bound to exactly one assessment/thread/execution.
 */
@Injectable()
export class AssessmentRuntimeAuthority {
  constructor(
    private readonly prisma: PrismaService,
    private readonly events: AssessmentEventAppender,
  ) {}

  /** Starts (or restarts after expiry/failure) the one Root execution of an ACTIVE assessment. */
  async claimRoot(input: {
    assessmentId: string;
    correlationId: string;
  }): Promise<AssessmentRootClaim> {
    return this.prisma.$transaction(async (tx) => {
      const row = await lockAssessmentAndRuntime(tx, input.assessmentId);
      if (!row) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
          input.correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }
      const blockedRequestId = humanFactBlockerRequestId(row);
      const blockedHumanWait =
        row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED &&
        blockedRequestId !== null &&
        (await tx.assessmentHumanRequest.count({
          where: {
            assessmentId: input.assessmentId,
            requestId: blockedRequestId,
            threadId: row.threadId,
            status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          },
        })) === 1;
      const recoveringHumanInterrupt =
        (row.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN ||
          blockedHumanWait) &&
        row.executionState === AGENT_EXECUTION_STATES.RUNNING &&
        row.leaseExpiresAt !== null &&
        row.leaseExpiresAt <= new Date();
      if (
        row.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE &&
        !recoveringHumanInterrupt
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      const now = new Date();
      if (
        row.leaseToken &&
        row.leaseExpiresAt &&
        row.leaseExpiresAt > now &&
        row.executionState === AGENT_EXECUTION_STATES.RUNNING
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_HELD,
          input.correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }
      // A human interrupt or safe pause resumes the SAME execution; a failed, finished or
      // never-started one begins a new execution ID on the same thread (retry semantics).
      const resumesSameExecution =
        row.currentExecutionId !== null &&
        (row.executionState === AGENT_EXECUTION_STATES.INTERRUPTED ||
          row.executionState === AGENT_EXECUTION_STATES.PAUSED);
      const executionId = resumesSameExecution
        ? (row.currentExecutionId as string)
        : randomUUID();
      const previousState = resumesSameExecution
        ? row.executionState
        : AGENT_EXECUTION_STATES.QUEUED;
      const leaseToken = randomUUID();
      const leaseExpiresAt = new Date(
        now.getTime() + ASSESSMENT_DOMAIN_LIMITS.LEASE_SECONDS * 1000,
      );
      await tx.assessmentRuntime.update({
        where: { assessmentId: input.assessmentId },
        data: {
          currentExecutionId: executionId,
          executionState: AGENT_EXECUTION_STATES.RUNNING,
          leaseToken,
          leaseExpiresAt,
          startedAt: now,
          lastResumedAt: now,
        },
      });
      await this.events.appendInTx(tx, {
        assessmentId: input.assessmentId,
        correlationId: input.correlationId,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.EXECUTION_STATE_CHANGED,
        actorType: ASSESSMENT_EVENT_ACTOR_TYPES.RUNTIME,
        executionId,
        payload: {
          fromState: previousState,
          toState: AGENT_EXECUTION_STATES.RUNNING,
        },
        auditActor: ROOT_ACTOR,
      });
      return {
        assessmentId: input.assessmentId,
        threadId: row.threadId,
        executionId,
        leaseToken,
        leaseExpiresAt: leaseExpiresAt.toISOString(),
        checkpointNamespace: row.checkpointNamespace,
        executionState: AGENT_EXECUTION_STATES.RUNNING,
        resumeCheckpointId: resumesSameExecution ? row.checkpointId : null,
      };
    });
  }

  /**
   * Validates a tool call's lease inside the caller's transaction and returns the server-owned
   * identity. Locks the runtime row so the lease cannot change underneath the write.
   */
  async authorizeInTx(
    tx: Prisma.TransactionClient,
    input: {
      assessmentId: string;
      leaseToken: string | undefined;
      correlationId: string;
      requireActive?: boolean;
    },
  ): Promise<AuthorizedRootRun> {
    const row = await lockAssessmentAndRuntime(tx, input.assessmentId);
    if (!row) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.RUNTIME_NOT_FOUND,
        input.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }
    if (
      !input.leaseToken ||
      row.leaseToken !== input.leaseToken ||
      !row.leaseExpiresAt ||
      row.leaseExpiresAt <= new Date() ||
      row.executionState !== AGENT_EXECUTION_STATES.RUNNING ||
      !row.currentExecutionId
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.EXECUTION_LEASE_INVALID,
        input.correlationId,
        { status: HttpStatus.FORBIDDEN },
      );
    }
    if (
      (input.requireActive ?? true) &&
      row.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE
    ) {
      throw problemException(
        ASSESSMENT_DOMAIN_ERROR_CODES.NOT_ACTIVE,
        input.correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    return {
      assessmentId: input.assessmentId,
      threadId: row.threadId,
      executionId: row.currentExecutionId,
      lifecycleState: row.lifecycleState ?? "",
      lifecycleRevision: row.lifecycleRevision ?? 0,
      blockerReason: row.blockerReason,
      blockerReference: row.blockerReference,
    };
  }

  async authorize(input: {
    assessmentId: string;
    leaseToken: string | undefined;
    correlationId: string;
    requireActive?: boolean;
  }): Promise<AuthorizedRootRun> {
    return this.prisma.$transaction((tx) => this.authorizeInTx(tx, input));
  }

  async heartbeat(input: {
    assessmentId: string;
    leaseToken: string | undefined;
    correlationId: string;
  }): Promise<{ leaseExpiresAt: string }> {
    return this.prisma.$transaction(async (tx) => {
      await this.authorizeInTx(tx, { ...input, requireActive: false });
      const leaseExpiresAt = new Date(
        Date.now() + ASSESSMENT_DOMAIN_LIMITS.LEASE_SECONDS * 1000,
      );
      await tx.assessmentRuntime.update({
        where: { assessmentId: input.assessmentId },
        data: { leaseExpiresAt },
      });
      return { leaseExpiresAt: leaseExpiresAt.toISOString() };
    });
  }

  /** Ends the current execution. A terminal state never implies an assessment outcome. */
  async finishExecution(input: {
    assessmentId: string;
    leaseToken: string | undefined;
    correlationId: string;
    toState: AgentExecutionState;
    checkpointId?: string;
    requestIds?: string[];
  }): Promise<{ executionState: AgentExecutionState }> {
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authorizeInTx(tx, {
        ...input,
        requireActive: false,
      });
      if (
        ![
          AGENT_EXECUTION_STATES.INTERRUPTED,
          AGENT_EXECUTION_STATES.PAUSED,
          AGENT_EXECUTION_STATES.SUCCEEDED,
          AGENT_EXECUTION_STATES.FAILED,
          AGENT_EXECUTION_STATES.CANCELLED,
        ].some((state) => state === input.toState)
      ) {
        throw problemException(
          ASSESSMENT_DOMAIN_ERROR_CODES.REQUEST_INVALID,
          input.correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }
      if (input.toState === AGENT_EXECUTION_STATES.INTERRUPTED) {
        const requests = await tx.assessmentHumanRequest.findMany({
          where: {
            assessmentId: input.assessmentId,
            status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          },
        });
        const ids = new Set(input.requestIds);
        const blockedRequestId = humanFactBlockerRequestId(run);
        const blockedHumanWait =
          run.lifecycleState === ASSESSMENT_LIFECYCLE_STATES.BLOCKED &&
          blockedRequestId !== null &&
          ids.has(blockedRequestId);
        if (
          !input.checkpointId ||
          requests.length === 0 ||
          requests.length !== ids.size ||
          (run.lifecycleState !==
            ASSESSMENT_LIFECYCLE_STATES.WAITING_FOR_HUMAN &&
            !blockedHumanWait) ||
          requests.some(
            (request) =>
              !ids.has(request.requestId) ||
              request.threadId !== run.threadId ||
              (request.checkpointId &&
                request.checkpointId !== input.checkpointId),
          )
        ) {
          throw problemException(
            ASSESSMENT_DOMAIN_ERROR_CODES.CHECKPOINT_INVALID,
            input.correlationId,
            { status: HttpStatus.CONFLICT },
          );
        }
        await tx.assessmentHumanRequest.updateMany({
          where: {
            assessmentId: input.assessmentId,
            status: HUMAN_RESOLUTION_REQUEST_STATUSES.OPEN,
          },
          data: { checkpointId: input.checkpointId },
        });
      }
      await tx.assessmentRuntime.update({
        where: { assessmentId: input.assessmentId },
        data: {
          executionState: input.toState,
          leaseToken: null,
          leaseExpiresAt: null,
          ...(input.checkpointId ? { checkpointId: input.checkpointId } : {}),
        },
      });
      await this.events.appendInTx(tx, {
        assessmentId: input.assessmentId,
        correlationId: input.correlationId,
        eventType: AGENTIC_ASSESSMENT_EVENT_TYPES.EXECUTION_STATE_CHANGED,
        actorType: ASSESSMENT_EVENT_ACTOR_TYPES.RUNTIME,
        executionId: run.executionId,
        payload: {
          fromState: AGENT_EXECUTION_STATES.RUNNING,
          toState: input.toState,
        },
        auditActor: ROOT_ACTOR,
      });
      return { executionState: input.toState };
    });
  }
}

interface LockedRuntimeRow {
  lifecycleState: string | null;
  lifecycleRevision: number | null;
  blockerReason: BlockerReason | null;
  blockerReference: Prisma.JsonValue | null;
  threadId: string;
  checkpointNamespace: string;
  checkpointId: string | null;
  currentExecutionId: string | null;
  executionState: AgentExecutionState;
  leaseToken: string | null;
  leaseExpiresAt: Date | null;
}

/** Same lock order as the lifecycle coordinator: assessment row, then runtime row. */
async function lockAssessmentAndRuntime(
  tx: Prisma.TransactionClient,
  assessmentId: string,
): Promise<LockedRuntimeRow | undefined> {
  const assessment = await tx.$queryRaw<
    Array<
      Pick<
        LockedRuntimeRow,
        | "lifecycleState"
        | "lifecycleRevision"
        | "blockerReason"
        | "blockerReference"
      >
    >
  >(
    Prisma.sql`SELECT "lifecycleState", "lifecycleRevision", "blockerReason", "blockerReference" FROM "Assessment"
      WHERE "id" = ${assessmentId} FOR UPDATE`,
  );
  if (!assessment[0]) return undefined;
  const runtime = await tx.$queryRaw<
    Array<
      Omit<
        LockedRuntimeRow,
        | "lifecycleState"
        | "lifecycleRevision"
        | "blockerReason"
        | "blockerReference"
      >
    >
  >(
    Prisma.sql`SELECT "threadId", "checkpointNamespace", "checkpointId", "currentExecutionId", "executionState",
        "leaseToken", "leaseExpiresAt"
      FROM "AssessmentRuntime" WHERE "assessmentId" = ${assessmentId} FOR UPDATE`,
  );
  if (!runtime[0]) return undefined;
  return { ...assessment[0], ...runtime[0] };
}

function humanFactBlockerRequestId(row: {
  blockerReason: unknown;
  blockerReference: unknown;
}): string | null {
  const blocker = assessmentBlockerSchema.safeParse({
    reason: row.blockerReason,
    reference: row.blockerReference,
  });
  return blocker.success &&
    blocker.data.reason === BLOCKER_REASONS.HUMAN_FACT_UNRESOLVABLE
    ? blocker.data.reference.humanResolutionRequestId
    : null;
}
