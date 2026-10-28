import { describe, expect, it, jest } from "@jest/globals";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import { AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AssessmentLifecycleCoordinator } from "../../services/assessment-lifecycle-coordinator.service.js";
import { ReconcileOrphanedAssessmentCommand } from "./reconcile-orphaned-assessment.command.js";
import { ReconcileOrphanedAssessmentHandler } from "./reconcile-orphaned-assessment.handler.js";

const id = "4869e591-8cf5-4cf3-b6a4-0ece9b974123";
const ownerId = "owner-1";

function fixture(overrides: { turnCount?: number; scanJobs?: boolean } = {}) {
  const transitionCalls: unknown[][] = [];
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([{ id }])),
    assessment: {
      findUnique: jest.fn(() =>
        Promise.resolve({
          id,
          ownerId,
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
          lifecycleRevision: 2,
          runtime: {
            executionState: AGENT_EXECUTION_STATES.QUEUED,
            currentExecutionId: null,
            leaseToken: null,
            leaseExpiresAt: null,
            checkpointId: null,
          },
        }),
      ),
    },
    assessmentRuntimeTurn: {
      count: jest.fn(() => Promise.resolve(overrides.turnCount ?? 0)),
    },
    assessmentRuntimeEvent: {
      count: jest.fn(() => Promise.resolve(0)),
      findFirst: jest.fn(() => Promise.resolve(null)),
    },
    assessmentRuntime: { update: jest.fn(() => Promise.resolve({})) },
    repositoryScanJob: {
      findMany: jest.fn(() =>
        Promise.resolve(
          overrides.scanJobs === false
            ? []
            : [{ id: "stale-scan", updatedAt: new Date(0) }],
        ),
      ),
      updateMany: jest.fn(() => Promise.resolve({ count: 1 })),
    },
  };
  const prisma = {
    $transaction: jest.fn((work: (client: typeof tx) => unknown) => work(tx)),
  } as unknown as PrismaService;
  const lifecycle = {
    transitionVerifiedInTx: jest.fn((...args: unknown[]) => {
      transitionCalls.push(args);
      return Promise.resolve({});
    }),
  } as unknown as AssessmentLifecycleCoordinator;
  return {
    handler: new ReconcileOrphanedAssessmentHandler(prisma, lifecycle),
    tx,
    lifecycle,
    transitionCalls,
  };
}

describe("ReconcileOrphanedAssessmentHandler", () => {
  it("fails only the stale scan and cancels an unowned queued assessment through lifecycle", async () => {
    const { handler, tx, transitionCalls } = fixture();
    await expect(
      handler.execute(
        new ReconcileOrphanedAssessmentCommand(id, ownerId, "corr-1"),
      ),
    ).resolves.toEqual({
      assessmentId: id,
      state: ASSESSMENT_LIFECYCLE_STATES.CANCELLED,
      reconciled: true,
    });
    expect(tx.repositoryScanJob.updateMany.mock.calls).toContainEqual([
      expect.objectContaining({
        where: { id: { in: ["stale-scan"] } },
      }),
    ]);
    expect(transitionCalls).toContainEqual([
      expect.objectContaining({
        assessmentId: id,
        toState: ASSESSMENT_LIFECYCLE_STATES.CANCELLED,
      }),
      tx,
      expect.any(Array),
      { id: ownerId, type: AUDIT_ACTOR_TYPES.user },
    ]);
    expect(tx.assessmentRuntime.update.mock.calls).toContainEqual([
      expect.objectContaining({
        data: expect.objectContaining({
          executionState: AGENT_EXECUTION_STATES.CANCELLED,
          leaseToken: null,
          leaseExpiresAt: null,
        }),
      }),
    ]);
  });

  it("refuses reconciliation while a runtime turn still exists", async () => {
    const { handler, tx } = fixture({ turnCount: 1 });
    await expect(
      handler.execute(
        new ReconcileOrphanedAssessmentCommand(id, ownerId, "corr-2"),
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(tx.repositoryScanJob.updateMany.mock.calls).toHaveLength(0);
    expect(tx.assessmentRuntime.update.mock.calls).toHaveLength(0);
  });

  it("refuses reconciliation when no stale scan ownership can be proven", async () => {
    const { handler, tx, transitionCalls } = fixture({ scanJobs: false });
    await expect(
      handler.execute(
        new ReconcileOrphanedAssessmentCommand(id, ownerId, "corr-3"),
      ),
    ).rejects.toBeInstanceOf(Error);
    expect(tx.repositoryScanJob.updateMany.mock.calls).toHaveLength(0);
    expect(transitionCalls).toHaveLength(0);
  });
});
