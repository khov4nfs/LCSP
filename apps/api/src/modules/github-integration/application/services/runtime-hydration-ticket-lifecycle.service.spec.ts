import { describe, expect, it, jest } from "@jest/globals";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import { ASSESSMENT_ROOT_BOUNDARY } from "@lcsp/contracts/assessment-domain";
import {
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
  RUNTIME_HYDRATION_TICKET_REASONS,
} from "@lcsp/contracts/github-integration";
import {
  AssessmentRuntimeControlState,
  RepositoryScanJobStatus,
} from "@prisma/client";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { RuntimeHydrationTicketLifecycle } from "./runtime-hydration-ticket-lifecycle.service.js";

describe("RuntimeHydrationTicketLifecycle", () => {
  const ticket: {
    id: string;
    assessmentId: string;
    snapshotId: string;
    status: RepositoryScanJobStatus;
    triggerSource: string;
    idempotencyKey: string;
    blockedReason: string | null;
  } = {
    id: "hydration-1",
    assessmentId: "assessment-1",
    snapshotId: "snapshot-1",
    status: RepositoryScanJobStatus.RUNNING,
    triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
    idempotencyKey: "runtime-hydration:assessment-1:snapshot-1",
    blockedReason: null,
  };

  function setup(options?: {
    ticket?: typeof ticket;
    runtimeState?: string;
    leaseToken?: string | null;
    turnState?: AssessmentRuntimeControlState;
  }) {
    const findTicket = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(options?.ticket ?? ticket);
    const updateTicket = jest
      .fn<(...args: unknown[]) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const runtime = {
      threadId: "thread-1",
      currentExecutionId: "execution-1",
      executionState: options?.runtimeState ?? AGENT_EXECUTION_STATES.SUCCEEDED,
      leaseToken: options?.leaseToken ?? null,
      leaseExpiresAt: null,
    };
    const findRuntime = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue(runtime);
    const findTurn = jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue({
        assessmentId: ticket.assessmentId,
        threadId: runtime.threadId,
        boundary: ASSESSMENT_ROOT_BOUNDARY,
        state: options?.turnState ?? AssessmentRuntimeControlState.COMPLETED,
      });
    const prisma = {
      repositoryScanJob: { findUnique: findTicket, updateMany: updateTicket },
      assessmentRuntime: { findUnique: findRuntime },
      assessmentCase: {
        findUnique: jest
          .fn<(...args: unknown[]) => Promise<unknown>>()
          .mockResolvedValue({
            repositoryScanJobId: ticket.id,
            repositorySnapshotId: ticket.snapshotId,
          }),
      },
      assessmentRuntimeTurn: { findUnique: findTurn },
    } as unknown as PrismaService;
    return {
      lifecycle: new RuntimeHydrationTicketLifecycle(prisma),
      prisma,
      findTicket,
      updateTicket,
      runtime,
      findRuntime,
      findTurn,
    };
  }

  it("recognizes only the exact trusted Assessment and snapshot hydration key", () => {
    const { lifecycle } = setup();
    expect(lifecycle.isHydrationTicket(ticket)).toBe(true);
    expect(
      lifecycle.isHydrationTicket({
        ...ticket,
        idempotencyKey: "runtime-hydration:other-assessment:snapshot-1",
      }),
    ).toBe(false);
    expect(
      lifecycle.isHydrationTicket({
        ...ticket,
        triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
      }),
    ).toBe(false);
  });

  it("claims queued hydration once and increments the delivery attempt", async () => {
    const { lifecycle, updateTicket } = setup();
    await lifecycle.claim(
      ticket.id,
      ticket.assessmentId,
      ticket.snapshotId,
      REPOSITORY_SCAN_JOB_STATUSES.queued,
    );
    expect(updateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: ticket.id,
          assessmentId: ticket.assessmentId,
          status: RepositoryScanJobStatus.QUEUED,
          idempotencyKey: `runtime-hydration:${ticket.assessmentId}:${ticket.snapshotId}`,
        }),
        data: expect.objectContaining({
          status: RepositoryScanJobStatus.RUNNING,
          attemptCount: { increment: 1 },
        }),
      }),
    );
  });

  it("rejects a duplicate claim while the same delivery is in flight", async () => {
    const { lifecycle } = setup();
    await lifecycle.claim(
      ticket.id,
      ticket.assessmentId,
      ticket.snapshotId,
      REPOSITORY_SCAN_JOB_STATUSES.queued,
    );
    await expect(
      lifecycle.claim(
        ticket.id,
        ticket.assessmentId,
        ticket.snapshotId,
        REPOSITORY_SCAN_JOB_STATUSES.queued,
      ),
    ).rejects.toThrow("already active");
  });

  it("finalizes success idempotently and refuses a conflicting terminal replay", async () => {
    const success = setup();
    success.findTicket.mockResolvedValueOnce(ticket).mockResolvedValueOnce({
      ...ticket,
      status: RepositoryScanJobStatus.COMPLETED,
    });
    await success.lifecycle.finalizeDelivery({
      ticketId: ticket.id,
      snapshotId: ticket.snapshotId,
      outcome: REPOSITORY_SCAN_JOB_STATUSES.completed,
    });
    expect(success.updateTicket).toHaveBeenCalledTimes(1);

    const replay = setup({
      ticket: { ...ticket, status: RepositoryScanJobStatus.COMPLETED },
    });
    await replay.lifecycle.finalizeDelivery({
      ticketId: ticket.id,
      snapshotId: ticket.snapshotId,
      outcome: REPOSITORY_SCAN_JOB_STATUSES.completed,
    });
    expect(replay.updateTicket).not.toHaveBeenCalled();
    await expect(
      replay.lifecycle.finalizeDelivery({
        ticketId: ticket.id,
        snapshotId: ticket.snapshotId,
        outcome: REPOSITORY_SCAN_JOB_STATUSES.failed,
      }),
    ).rejects.toThrow("conflicting terminal state");
  });

  it("accepts a duplicate failure finalization without writing twice", async () => {
    const failed = setup();
    failed.findTicket.mockResolvedValueOnce(ticket).mockResolvedValueOnce({
      ...ticket,
      status: RepositoryScanJobStatus.FAILED,
      blockedReason: RUNTIME_HYDRATION_TICKET_REASONS.deliveryFailed,
    });
    const input = {
      ticketId: ticket.id,
      snapshotId: ticket.snapshotId,
      outcome: REPOSITORY_SCAN_JOB_STATUSES.failed,
    } as const;
    await failed.lifecycle.finalizeDelivery(input);
    await failed.lifecycle.finalizeDelivery(input);
    expect(failed.updateTicket).toHaveBeenCalledTimes(1);
  });

  it("settles concurrent duplicate success finalizers without changing the terminal outcome", async () => {
    const { lifecycle, prisma, findTicket, updateTicket } = setup();
    findTicket
      .mockResolvedValueOnce(ticket)
      .mockResolvedValueOnce(ticket)
      .mockResolvedValueOnce({
        ...ticket,
        status: RepositoryScanJobStatus.COMPLETED,
      });
    updateTicket
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValueOnce({ count: 0 });
    const secondInstance = new RuntimeHydrationTicketLifecycle(prisma);
    const input = {
      ticketId: ticket.id,
      snapshotId: ticket.snapshotId,
      outcome: REPOSITORY_SCAN_JOB_STATUSES.completed,
    } as const;

    await expect(
      Promise.all([
        lifecycle.finalizeDelivery(input),
        secondInstance.finalizeDelivery(input),
      ]),
    ).resolves.toHaveLength(2);
    expect(updateTicket).toHaveBeenCalledTimes(2);
  });

  it("marks terminal Root tickets retryable without claiming archive delivery succeeded", async () => {
    const { lifecycle, updateTicket, findRuntime, findTurn } = setup({
      runtimeState: AGENT_EXECUTION_STATES.SUCCEEDED,
    });
    const result = await lifecycle.reconcileTerminalRuntime({
      ticketId: ticket.id,
      snapshotId: ticket.snapshotId,
    });

    expect(result).toEqual({
      status: REPOSITORY_SCAN_JOB_STATUSES.failed,
      changed: true,
    });
    expect(updateTicket).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: RepositoryScanJobStatus.RUNNING,
        }),
        data: expect.objectContaining({
          status: RepositoryScanJobStatus.FAILED,
          blockedReason: RUNTIME_HYDRATION_TICKET_REASONS.outcomeUnproven,
        }),
      }),
    );
    expect(findRuntime).toHaveBeenCalledTimes(1);
    expect(findTurn).toHaveBeenCalledTimes(1);
  });

  it.each([AGENT_EXECUTION_STATES.FAILED, AGENT_EXECUTION_STATES.SUCCEEDED])(
    "reconciles terminal runtime state %s only as unproven and retryable",
    async (runtimeState) => {
      const { lifecycle, updateTicket } = setup({ runtimeState });
      await lifecycle.reconcileTerminalRuntime({
        ticketId: ticket.id,
        snapshotId: ticket.snapshotId,
      });
      expect(updateTicket).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            status: RepositoryScanJobStatus.FAILED,
            blockedReason: RUNTIME_HYDRATION_TICKET_REASONS.outcomeUnproven,
          }),
        }),
      );
    },
  );

  it("refuses reconciliation while the Root still has a lease", async () => {
    const { lifecycle, updateTicket } = setup({ leaseToken: "lease-1" });
    await expect(
      lifecycle.reconcileTerminalRuntime({
        ticketId: ticket.id,
        snapshotId: ticket.snapshotId,
      }),
    ).rejects.toThrow("not safely reconcilable");
    expect(updateTicket).not.toHaveBeenCalled();
  });
});
