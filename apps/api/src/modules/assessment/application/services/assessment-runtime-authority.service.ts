import { randomUUID } from "node:crypto";

import {
  AGENT_EXECUTION_STATES,
  AGENTIC_ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_EVENT_ACTOR_TYPES,
  ASSESSMENT_LIFECYCLE_STATES,
  type AgentExecutionState,
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
      if (row.lifecycleState !== ASSESSMENT_LIFECYCLE_STATES.ACTIVE) {
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
  }): Promise<{ executionState: AgentExecutionState }> {
    return this.prisma.$transaction(async (tx) => {
      const run = await this.authorizeInTx(tx, {
        ...input,
        requireActive: false,
      });
      await tx.assessmentRuntime.update({
        where: { assessmentId: input.assessmentId },
        data: {
          executionState: input.toState,
          leaseToken: null,
          leaseExpiresAt: null,
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
  threadId: string;
  checkpointNamespace: string;
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
    Array<{ lifecycleState: string | null; lifecycleRevision: number | null }>
  >(
    Prisma.sql`SELECT "lifecycleState", "lifecycleRevision" FROM "Assessment"
      WHERE "id" = ${assessmentId} FOR UPDATE`,
  );
  if (!assessment[0]) return undefined;
  const runtime = await tx.$queryRaw<
    Array<Omit<LockedRuntimeRow, "lifecycleState" | "lifecycleRevision">>
  >(
    Prisma.sql`SELECT "threadId", "checkpointNamespace", "currentExecutionId", "executionState",
        "leaseToken", "leaseExpiresAt"
      FROM "AssessmentRuntime" WHERE "assessmentId" = ${assessmentId} FOR UPDATE`,
  );
  if (!runtime[0]) return undefined;
  return { ...assessment[0], ...runtime[0] };
}
