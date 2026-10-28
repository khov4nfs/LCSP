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

  /**
   * Business purpose: Identify a repository scan job created specifically to hydrate an Assessment Root's pinned snapshot.
   *
   * Business rules:
   * - The trigger must be TRUSTED and the idempotency key must exactly bind the ticket to its assessment and snapshot.
   * - A matching key prefix alone is insufficient when either pinned identity differs.
   *
   * Execution flow:
   * 1. Compare the trigger source with the trusted-trigger contract value.
   * 2. Compare the idempotency key with the assessment/snapshot-qualified hydration key.
   * 3. Return true only when both identity checks pass.
   *
   * Failure cases:
   * - Any mismatch returns false so callers cannot use hydration-specific lifecycle rules for an ordinary scan job.
   *
   * Side effects:
   * - None: this is a deterministic predicate over supplied ticket fields.
   */
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

  /**
   * Business purpose: Claim one retryable trusted hydration ticket before delivering its pinned repository archive.
   *
   * Business rules:
   * - Only QUEUED and FAILED states may be claimed; the database update must match ticket, assessment, snapshot, trigger, key, and prior state.
   * - An in-process active-delivery set prevents concurrent claims for the same ticket within this service instance.
   * - A successful claim increments attempts and clears the prior blocked reason.
   *
   * Execution flow:
   * 1. Reject nonretryable states and tickets already active in this process.
   * 2. Mark the ticket active locally, then conditionally transition the exact database row to RUNNING.
   * 3. Remove the local active marker if persistence fails; retain it until finalization after a successful claim.
   *
   * Failure cases:
   * - Nonretryable state, duplicate local delivery, or a failed conditional update raises a conflict.
   * - Any database error propagates after releasing the local marker.
   *
   * Side effects:
   * - Updates the matching RepositoryScanJob to RUNNING, increments its attempt count, clears its blocked reason, and maintains an in-memory delivery guard.
   */
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

  /**
   * Business purpose: Persist the completed or failed outcome of a claimed pinned-archive delivery.
   *
   * Business rules:
   * - The ticket must be a trusted hydration ticket for the supplied snapshot.
   * - A RUNNING ticket may transition to the requested terminal outcome; an already identical terminal result is idempotent, while conflicting states are rejected.
   * - Failed delivery records the delivery-failed reason; successful delivery clears the blocked reason.
   *
   * Execution flow:
   * 1. Load and verify ticket, snapshot, trusted trigger, and idempotency identity.
   * 2. Return for an exact already-finalized result or require the persisted state to remain RUNNING.
   * 3. Conditionally write the terminal status and reconcile a lost update only when the persisted result matches exactly.
   * 4. Release the in-process active-delivery marker in all cases.
   *
   * Failure cases:
   * - Identity mismatch, a conflicting terminal state, or a race to a different outcome raises a conflict.
   * - Database failures propagate; the local active marker is still cleared in `finally`.
   *
   * Side effects:
   * - May update RepositoryScanJob status and blocked reason; always releases the ticket from the in-memory active-delivery set.
   */
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

  /**
   * Business purpose: Safely close a stranded hydration ticket after its pinned Assessment Root execution has become terminal.
   *
   * Business rules:
   * - Reconciliation is forbidden during an active local delivery and requires exact trusted ticket/snapshot identity.
   * - The runtime must have no active lease, the AssessmentCase must pin this ticket and snapshot, and the completed turn must belong to the Root boundary and runtime thread.
   * - A terminal Root permits the stranded ticket to be reconciled as FAILED with outcome-unproven reason; it does not prove archive delivery.
   *
   * Execution flow:
   * 1. Reject an active delivery, load the ticket, and verify its trusted identity.
   * 2. Return the current status unchanged when the ticket is no longer RUNNING.
   * 3. Verify runtime lease, pinned case, completed Root turn, and terminal execution state.
   * 4. Conditionally persist the explicit outcome-unproven failure and accept a concurrent update only when it matches that outcome.
   *
   * Failure cases:
   * - Active delivery, mismatched pin/thread/boundary, a live lease, nonterminal execution, or conflicting update raises a conflict.
   * - Database errors propagate; no successful archive-delivery outcome is inferred from runtime termination alone.
   *
   * Side effects:
   * - May transition the RepositoryScanJob to FAILED with the outcome-unproven reason; otherwise returns the verified current status without mutation.
   */
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
