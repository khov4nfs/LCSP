import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS as Actions,
  ASSESSMENT_RUNTIME_CONTROL_PROBLEM_CODES as Problems,
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
} from "@lcsp/contracts/evidence";
import type { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import type { OutboxRepository } from "../outbox/outbox.repository.js";
import type { AssessmentLifecycleCoordinator } from "../../modules/assessment/application/services/assessment-lifecycle-coordinator.service.js";
import { AssessmentRuntimeControlService } from "./assessment-runtime-control.service.js";

const actor = {
  userId: "actor",
  sessionId: "session",
  role: AUTH_USER_ROLES.customer,
  scope: null,
};

describe("runtime control registration", () => {
  it.each([Actions.stop, Actions.resume])(
    "rejects %s without a native registration instead of reporting completion",
    async (action) => {
      const tx = {
        $queryRaw: jest.fn<() => Promise<unknown[]>>().mockResolvedValue([]),
        assessmentRuntime: {
          findUnique: jest.fn<() => Promise<null>>().mockResolvedValue(null),
        },
        assessmentRuntimeTurn: {
          findFirst: jest.fn<() => Promise<null>>().mockResolvedValue(null),
        },
      };
      const prisma = {
        $transaction: async (work: (value: typeof tx) => Promise<unknown>) =>
          work(tx),
      };
      const outbox = { enqueue: jest.fn() };
      const events = { publishAgentStreamEvent: jest.fn() };
      const lifecycle = {};
      const controls = new AssessmentRuntimeControlService(
        prisma as unknown as PrismaService,
        outbox as unknown as OutboxRepository,
        lifecycle as unknown as AssessmentLifecycleCoordinator,
      );
      await expect(
        controls.request({
          assessmentId: "assessment",
          actor,
          correlationId: "correlation",
          action,
          targetRunId: "visible-run",
        }),
      ).rejects.toMatchObject({
        status: 409,
        response: {
          ok: false,
          problem: {
            code: Problems.staleTarget,
            status: 409,
            correlationId: "correlation",
          },
        },
      });
      expect(outbox.enqueue).not.toHaveBeenCalled();
      expect(events.publishAgentStreamEvent).not.toHaveBeenCalled();
    },
  );

  it("reads the canonical current turn instead of the newest persisted turn", async () => {
    const canonical = {
      id: "canonical-run",
      assessmentId: "assessment",
      threadId: "root-thread",
      state: States.running,
      requestId: null,
    };
    const prisma = {
      assessmentRuntime: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          assessmentId: "assessment",
          threadId: "root-thread",
          checkpointNamespace: "assessment",
          currentExecutionId: canonical.id,
        }),
      },
      assessmentRuntimeTurn: {
        findUnique: jest
          .fn<() => Promise<unknown>>()
          .mockResolvedValue(canonical),
        findFirst: jest.fn(),
      },
    };
    const controls = new AssessmentRuntimeControlService(
      prisma as unknown as PrismaService,
      {} as OutboxRepository,
      {} as AssessmentLifecycleCoordinator,
    );

    await expect(controls.current("assessment")).resolves.toEqual({
      state: States.running,
      targetRunId: "canonical-run",
      requestId: null,
    });
    expect(prisma.assessmentRuntimeTurn.findFirst).not.toHaveBeenCalled();
  });

  it("rejects a stop target from another thread instead of queueing against it", async () => {
    const canonical = {
      id: "canonical-run",
      assessmentId: "assessment",
      threadId: "root-thread",
      boundary: "root",
      logicalRunId: "logical-run",
      state: States.running,
      requestId: null,
    };
    const unrelated = {
      ...canonical,
      id: "unrelated-run",
      threadId: "other-thread",
      state: States.running,
    };
    const updateMany = jest.fn();
    const tx = {
      $queryRaw: jest
        .fn<() => Promise<unknown[]>>()
        .mockResolvedValue([
          { id: "assessment", ownerId: "actor" },
          { assessmentId: "assessment" },
        ]),
      assessmentRuntime: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          assessmentId: "assessment",
          threadId: "root-thread",
          checkpointNamespace: "assessment",
          currentExecutionId: canonical.id,
        }),
      },
      assessmentRuntimeTurn: {
        findUnique: jest
          .fn()
          .mockImplementation(({ where }: { where: { id: string } }) =>
            Promise.resolve(where.id === canonical.id ? canonical : unrelated),
          ),
        updateMany,
      },
    };
    const controls = new AssessmentRuntimeControlService(
      {
        $transaction: async (work: (value: typeof tx) => Promise<unknown>) =>
          work(tx),
      } as unknown as PrismaService,
      {} as OutboxRepository,
      {} as AssessmentLifecycleCoordinator,
    );

    await expect(
      controls.request({
        assessmentId: "assessment",
        actor,
        correlationId: "corr",
        action: Actions.stop,
        targetRunId: unrelated.id,
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("fails closed before changing a stopped turn when resume authority is unavailable", async () => {
    const updateMany = jest.fn();
    const enqueue = jest.fn();
    const publish = jest.fn();
    const queryRaw = jest.fn<() => Promise<unknown[]>>();
    queryRaw.mockResolvedValue([
      { id: "assessment", ownerId: "actor" },
      { assessmentId: "assessment" },
    ]);
    const runtimeFindUnique = jest.fn<() => Promise<unknown>>();
    runtimeFindUnique.mockResolvedValue({
      assessmentId: "assessment",
      threadId: "root-thread",
      checkpointNamespace: "assessment",
      currentExecutionId: "stopped-run",
    });
    const turnFindUnique = jest.fn<() => Promise<unknown>>();
    turnFindUnique.mockResolvedValue({
      id: "stopped-run",
      assessmentId: "assessment",
      threadId: "root-thread",
      boundary: "root",
      logicalRunId: "logical-run",
      state: States.stopped,
      requestId: "stop-request",
    });
    const tx = {
      $queryRaw: queryRaw,
      assessmentRuntime: {
        findUnique: runtimeFindUnique,
      },
      assessmentRuntimeTurn: {
        findUnique: turnFindUnique,
        updateMany,
      },
    };
    const controls = new AssessmentRuntimeControlService(
      {
        $transaction: async (work: (value: typeof tx) => Promise<unknown>) =>
          work(tx),
      } as unknown as PrismaService,
      { enqueue } as unknown as OutboxRepository,
      {} as AssessmentLifecycleCoordinator,
    );

    await expect(
      controls.request({
        assessmentId: "assessment",
        actor,
        correlationId: "corr",
        action: Actions.resume,
        targetRunId: "stopped-run",
      }),
    ).rejects.toMatchObject({ status: 409 });
    expect(updateMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
    expect(publish).not.toHaveBeenCalled();
  });
});
