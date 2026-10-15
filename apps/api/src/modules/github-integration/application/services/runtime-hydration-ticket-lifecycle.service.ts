import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import { ASSESSMENT_ROOT_BOUNDARY } from "@lcsp/contracts/assessment-domain";
import {
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
  RUNTIME_HYDRATION_TICKET_REASONS,
  type RepositoryScanJobStatus,
} from "@lcsp/contracts/github-integration";
import { ConflictException, Injectable } from "@nestjs/common";
import {
  AssessmentRuntimeControlState as PrismaTurnState,
  RepositoryScanJobStatus as PrismaScanStatus,
  RepositoryScanTriggerSource as PrismaTriggerSource,
} from "@prisma/client";

import {
  fromPrismaRepositoryScanJobStatus,
  toPrismaRepositoryScanJobStatus,
} from "../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

const HYDRATION_KEY_PREFIX = "runtime-hydration:";
const DELIVERY_FAILED_REASON = RUNTIME_HYDRATION_TICKET_REASONS.deliveryFailed;
const OUTCOME_UNPROVEN_REASON =
  RUNTIME_HYDRATION_TICKET_REASONS.outcomeUnproven;

type DeliveryOutcome =
  | typeof REPOSITORY_SCAN_JOB_STATUSES.completed
  | typeof REPOSITORY_SCAN_JOB_STATUSES.failed;

@Injectable()
export class RuntimeHydrationTicketLifecycle {
  private readonly activeDeliveries = new Set<string>();

  constructor(private readonly prisma: PrismaService) {}

  isHydrationTicket(ticket: {
    assessmentId: string;
    snapshotId: string;
    triggerSource: string;
    idempotencyKey: string;
  }): boolean {
    return (
      ticket.triggerSource === REPOSITORY_SCAN_TRIGGER_SOURCES.trusted &&
      ticket.idempotencyKey ===
        `${HYDRATION_KEY_PREFIX}${ticket.assessmentId}:${ticket.snapshotId}`
    );
  }

  async claim(
    ticketId: string,
    assessmentId: string,
    snapshotId: string,
    fromStatus: RepositoryScanJobStatus,
  ): Promise<void> {
    if (
      fromStatus !== REPOSITORY_SCAN_JOB_STATUSES.queued &&
      fromStatus !== REPOSITORY_SCAN_JOB_STATUSES.failed
    ) {
      throw new ConflictException("Runtime hydration ticket is not retryable");
    }
    if (this.activeDeliveries.has(ticketId)) {
      throw new ConflictException(
        "Runtime hydration delivery is already active",
      );
    }
    this.activeDeliveries.add(ticketId);
    try {
      const claimed = await this.prisma.repositoryScanJob.updateMany({
        where: {
          id: ticketId,
          assessmentId,
          snapshotId,
          triggerSource: PrismaTriggerSource.TRUSTED,
          idempotencyKey: `${HYDRATION_KEY_PREFIX}${assessmentId}:${snapshotId}`,
          status: toPrismaRepositoryScanJobStatus(fromStatus),
        },
        data: {
          status: PrismaScanStatus.RUNNING,
          attemptCount: { increment: 1 },
          blockedReason: null,
        },
      });
      if (claimed.count !== 1) {
        throw new ConflictException(
          "Runtime hydration ticket could not be claimed",
        );
      }
    } catch (error: unknown) {
      this.activeDeliveries.delete(ticketId);
      throw error;
    }
  }

  async finalizeDelivery(input: {
    ticketId: string;
    snapshotId: string;
    outcome: DeliveryOutcome;
  }): Promise<void> {
    try {
      const ticket = await this.prisma.repositoryScanJob.findUnique({
        where: { id: input.ticketId },
        select: {
          assessmentId: true,
          snapshotId: true,
          status: true,
          triggerSource: true,
          idempotencyKey: true,
          blockedReason: true,
        },
      });
      if (
        !ticket ||
        ticket.snapshotId !== input.snapshotId ||
        !this.isHydrationTicket(ticket)
      ) {
        throw new ConflictException(
          "Runtime hydration ticket identity mismatch",
        );
      }

      const reason =
        input.outcome === REPOSITORY_SCAN_JOB_STATUSES.failed
          ? DELIVERY_FAILED_REASON
          : null;
      if (ticket.status !== PrismaScanStatus.RUNNING) {
        if (
          ticket.status === toPrismaRepositoryScanJobStatus(input.outcome) &&
          ticket.blockedReason === reason
        ) {
          return;
        }
        throw new ConflictException(
          "Runtime hydration ticket has a conflicting terminal state",
        );
      }

      const finalized = await this.prisma.repositoryScanJob.updateMany({
        where: {
          id: input.ticketId,
          assessmentId: ticket.assessmentId,
          snapshotId: input.snapshotId,
          triggerSource: PrismaTriggerSource.TRUSTED,
          idempotencyKey: `${HYDRATION_KEY_PREFIX}${ticket.assessmentId}:${input.snapshotId}`,
          status: PrismaScanStatus.RUNNING,
        },
        data: {
          status: toPrismaRepositoryScanJobStatus(input.outcome),
          blockedReason: reason,
        },
      });
      if (finalized.count !== 1) {
        const current = await this.prisma.repositoryScanJob.findUnique({
          where: { id: input.ticketId },
          select: { status: true, blockedReason: true },
        });
        if (
          current?.status !== toPrismaRepositoryScanJobStatus(input.outcome) ||
          current.blockedReason !== reason
        ) {
          throw new ConflictException(
            "Runtime hydration ticket finalization raced with another outcome",
          );
        }
      }
    } finally {
      this.activeDeliveries.delete(input.ticketId);
    }
  }

  async reconcileTerminalRuntime(input: {
    ticketId: string;
    snapshotId: string;
  }): Promise<{ status: RepositoryScanJobStatus; changed: boolean }> {
    if (this.activeDeliveries.has(input.ticketId)) {
      throw new ConflictException("Runtime hydration delivery is still active");
    }
    const ticket = await this.prisma.repositoryScanJob.findUnique({
      where: { id: input.ticketId },
      select: {
        id: true,
        assessmentId: true,
        snapshotId: true,
        status: true,
        triggerSource: true,
        idempotencyKey: true,
      },
    });
    if (
      !ticket ||
      ticket.snapshotId !== input.snapshotId ||
      !this.isHydrationTicket(ticket)
    ) {
      throw new ConflictException("Runtime hydration ticket identity mismatch");
    }
    if (ticket.status !== PrismaScanStatus.RUNNING) {
      return {
        status: fromPrismaRepositoryScanJobStatus(ticket.status),
        changed: false,
      };
    }

    const [runtime, pinnedCase] = await Promise.all([
      this.prisma.assessmentRuntime.findUnique({
        where: { assessmentId: ticket.assessmentId },
        select: {
          threadId: true,
          currentExecutionId: true,
          executionState: true,
          leaseToken: true,
          leaseExpiresAt: true,
        },
      }),
      this.prisma.assessmentCase.findUnique({
        where: { assessmentId: ticket.assessmentId },
        select: { repositoryScanJobId: true, repositorySnapshotId: true },
      }),
    ]);
    if (
      !runtime?.currentExecutionId ||
      runtime.leaseToken !== null ||
      runtime.leaseExpiresAt !== null ||
      !pinnedCase ||
      pinnedCase.repositoryScanJobId !== ticket.id ||
      pinnedCase.repositorySnapshotId !== ticket.snapshotId
    ) {
      throw new ConflictException(
        "Runtime hydration outcome is not safely reconcilable",
      );
    }

    const turn = await this.prisma.assessmentRuntimeTurn.findUnique({
      where: { id: runtime.currentExecutionId },
      select: {
        assessmentId: true,
        threadId: true,
        boundary: true,
        state: true,
      },
    });
    if (
      !turn ||
      turn.assessmentId !== ticket.assessmentId ||
      turn.threadId !== runtime.threadId ||
      turn.boundary !== ASSESSMENT_ROOT_BOUNDARY ||
      turn.state !== PrismaTurnState.COMPLETED
    ) {
      throw new ConflictException(
        "Runtime hydration outcome is not safely reconcilable",
      );
    }

    const terminalStates = new Set<string>([
      AGENT_EXECUTION_STATES.SUCCEEDED,
      AGENT_EXECUTION_STATES.FAILED,
      AGENT_EXECUTION_STATES.CANCELLED,
      AGENT_EXECUTION_STATES.INTERRUPTED,
    ]);
    const terminalRuntime = terminalStates.has(runtime.executionState);
    if (!terminalRuntime) {
      throw new ConflictException("Assessment Root execution is not terminal");
    }

    // A terminal Root proves it is safe to recover the ticket, but not that this ticket's
    // archive was fetched: the sandbox may already have contained the pinned snapshot.
    const outcome = REPOSITORY_SCAN_JOB_STATUSES.failed;
    const reason = OUTCOME_UNPROVEN_REASON;
    const reconciled = await this.prisma.repositoryScanJob.updateMany({
      where: {
        id: ticket.id,
        assessmentId: ticket.assessmentId,
        snapshotId: ticket.snapshotId,
        triggerSource: PrismaTriggerSource.TRUSTED,
        idempotencyKey: `${HYDRATION_KEY_PREFIX}${ticket.assessmentId}:${ticket.snapshotId}`,
        status: PrismaScanStatus.RUNNING,
      },
      data: {
        status: toPrismaRepositoryScanJobStatus(outcome),
        blockedReason: reason,
      },
    });
    if (reconciled.count !== 1) {
      const current = await this.prisma.repositoryScanJob.findUnique({
        where: { id: ticket.id },
        select: { status: true, blockedReason: true },
      });
      if (
        current?.status !== toPrismaRepositoryScanJobStatus(outcome) ||
        current.blockedReason !== reason
      ) {
        throw new ConflictException(
          "Runtime hydration reconciliation raced with another outcome",
        );
      }
    }
    return { status: outcome, changed: reconciled.count === 1 };
  }
}
