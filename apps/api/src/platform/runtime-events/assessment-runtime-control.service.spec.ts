import { describe, expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import {
  ASSESSMENT_ROOT_BOUNDARY,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
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

  it("rejects resume with BUDGET_EXHAUSTED when budget was reached and not extended", async () => {
    const updateMany = jest.fn();
    const enqueue = jest.fn();
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
      boundary: ASSESSMENT_ROOT_BOUNDARY,
      logicalRunId: "logical-run",
      state: States.stopped,
      requestId: "stop-request",
      checkpointJson: { checkpointId: "cp-1" },
    });
    const tx = {
      $queryRaw: queryRaw,
      assessmentRuntime: { findUnique: runtimeFindUnique },
      assessmentRuntimeTurn: { findUnique: turnFindUnique, updateMany },
      assessment: {
        findUniqueOrThrow: jest.fn<() => Promise<any>>().mockResolvedValue({
          id: "assessment",
          lifecycleState: "PAUSED",
          runtime: { executionState: "PAUSED", checkpointId: "cp-1" },
          blockerReference: {
            reason: "AGENT_BUDGET_REACHED",
            budgetExtended: false,
          },
          domainCase: {
            repositorySnapshotId: "snap-1",
            ruleSetVersionId: "ver-1",
            repositoryScanJobId: "job-1",
            repositoryCommit: "sha-1",
            ruleSet: { lifecycleState: "ACTIVE" },
          },
        }),
      },
      repositorySnapshot: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
          id: "snap-1",
          assessmentId: "assessment",
          commitSha: "sha-1",
        }),
      },
      assessmentHumanRequest: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
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
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.BUDGET_EXHAUSTED,
        }),
      }),
    });
    expect(updateMany).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });

  it("permits resume and preserves budget extension in blockerReference", async () => {
    const updateMany = jest
      .fn<(args?: any) => Promise<{ count: number }>>()
      .mockResolvedValue({ count: 1 });
    const updateAssessment = jest
      .fn<(args?: any) => Promise<any>>()
      .mockResolvedValue({});
    const enqueue = jest
      .fn<(args?: any) => Promise<any>>()
      .mockResolvedValue({});
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
      boundary: ASSESSMENT_ROOT_BOUNDARY,
      logicalRunId: "logical-run",
      state: States.stopped,
      requestId: "stop-request",
      checkpointJson: { checkpointId: "cp-1" },
    });
    const tx = {
      $queryRaw: queryRaw,
      assessmentRuntime: { findUnique: runtimeFindUnique },
      assessmentRuntimeTurn: { findUnique: turnFindUnique, updateMany },
      assessment: {
        findUniqueOrThrow: jest.fn<() => Promise<any>>().mockResolvedValue({
          id: "assessment",
          lifecycleState: "PAUSED",
          runtime: { executionState: "PAUSED", checkpointId: "cp-1" },
          blockerReference: {
            reason: "AGENT_BUDGET_REACHED",
            budgetExtended: true,
          },
          domainCase: {
            repositorySnapshotId: "snap-1",
            ruleSetVersionId: "ver-1",
            repositoryScanJobId: "job-1",
            repositoryCommit: "sha-1",
            ruleSet: { lifecycleState: "ACTIVE" },
          },
        }),
        update: updateAssessment,
      },
      repositorySnapshot: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
          id: "snap-1",
          assessmentId: "assessment",
          commitSha: "sha-1",
        }),
      },
      assessmentHumanRequest: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
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

    const result = await controls.request({
      assessmentId: "assessment",
      actor,
      correlationId: "corr",
      action: Actions.resume,
      targetRunId: "stopped-run",
    });

    expect(updateAssessment).toHaveBeenCalledWith({
      where: { id: "assessment" },
      data: {
        blockerReference: expect.objectContaining({
          reason: null,
          resumedAt: expect.any(String),
          budgetExtended: true,
        }),
      },
    });
    expect(updateMany).toHaveBeenCalled();
    expect(enqueue).toHaveBeenCalled();
    expect(result.state).toBe(States.resumeRequested);
  });

  it("permits admin to supply versioned budgetExtension on resume", async () => {
    const updateAssessment = jest
      .fn<(args?: any) => Promise<any>>()
      .mockResolvedValue({});
    const adminActor = {
      userId: "admin-user",
      sessionId: "session-admin",
      role: AUTH_USER_ROLES.admin,
      scope: null,
    };
    const queryRaw = jest.fn<() => Promise<unknown[]>>();
    queryRaw.mockResolvedValue([
      { id: "assessment", ownerId: "admin-user" },
      { assessmentId: "assessment" },
    ]);
    const tx = {
      $queryRaw: queryRaw,
      assessmentRuntime: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          assessmentId: "assessment",
          threadId: "root-thread",
          checkpointNamespace: "assessment",
          currentExecutionId: "stopped-run",
        }),
      },
      assessmentRuntimeTurn: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          id: "stopped-run",
          assessmentId: "assessment",
          threadId: "root-thread",
          boundary: ASSESSMENT_ROOT_BOUNDARY,
          logicalRunId: "logical-run",
          state: States.stopped,
          requestId: "stop-request",
          checkpointJson: { checkpointId: "cp-1" },
        }),
        updateMany: jest
          .fn<(args?: any) => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 1 }),
      },
      assessment: {
        findUniqueOrThrow: jest.fn<() => Promise<any>>().mockResolvedValue({
          id: "assessment",
          lifecycleState: "PAUSED",
          runtime: { executionState: "PAUSED", checkpointId: "cp-1" },
          blockerReference: { reason: "AGENT_BUDGET_REACHED" },
          domainCase: {
            repositorySnapshotId: "snap-1",
            ruleSetVersionId: "ver-1",
            repositoryScanJobId: "job-1",
            repositoryCommit: "sha-1",
            ruleSet: { lifecycleState: "ACTIVE" },
          },
        }),
        update: updateAssessment,
      },
      repositorySnapshot: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
          id: "snap-1",
          assessmentId: "assessment",
          commitSha: "sha-1",
        }),
      },
      assessmentHumanRequest: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
      },
    };
    const controls = new AssessmentRuntimeControlService(
      {
        $transaction: async (work: (value: typeof tx) => Promise<unknown>) =>
          work(tx),
      } as unknown as PrismaService,
      { enqueue: jest.fn() } as unknown as OutboxRepository,
      {} as AssessmentLifecycleCoordinator,
    );

    const result = await controls.request({
      assessmentId: "assessment",
      actor: adminActor,
      correlationId: "corr-admin",
      action: Actions.resume,
      targetRunId: "stopped-run",
      budgetExtension: {
        version: 1,
        additionalModelCalls: 50,
        auditReason: "Admin extended assessment budget by 50 model calls",
      },
    });

    expect(result.state).toBe(States.resumeRequested);
    expect(updateAssessment).toHaveBeenCalledWith({
      where: { id: "assessment" },
      data: {
        blockerReference: expect.objectContaining({
          reason: null,
          resumedAt: expect.any(String),
          budgetExtension: expect.objectContaining({
            version: 1,
            authorizedBy: "admin-user",
            auditReason: "Admin extended assessment budget by 50 model calls",
            additionalModelCalls: 50,
          }),
        }),
      },
    });
  });

  it("rejects non-admin actor attempting to supply budgetExtension with 403 Forbidden", async () => {
    const customerActor = {
      userId: "cust-1",
      sessionId: "session-cust",
      role: AUTH_USER_ROLES.customer,
      scope: null,
    };
    const queryRaw = jest.fn<() => Promise<unknown[]>>();
    queryRaw.mockResolvedValue([
      { id: "assessment", ownerId: "cust-1" },
      { assessmentId: "assessment" },
    ]);
    const tx = {
      $queryRaw: queryRaw,
      assessmentRuntime: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          assessmentId: "assessment",
          threadId: "root-thread",
          checkpointNamespace: "assessment",
          currentExecutionId: "stopped-run",
        }),
      },
      assessmentRuntimeTurn: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          id: "stopped-run",
          assessmentId: "assessment",
          threadId: "root-thread",
          boundary: ASSESSMENT_ROOT_BOUNDARY,
          logicalRunId: "logical-run",
          state: States.stopped,
          requestId: "stop-request",
          checkpointJson: { checkpointId: "cp-1" },
        }),
      },
      assessment: {
        findUniqueOrThrow: jest.fn<() => Promise<any>>().mockResolvedValue({
          id: "assessment",
          lifecycleState: "PAUSED",
          runtime: { executionState: "PAUSED", checkpointId: "cp-1" },
          blockerReference: { reason: "AGENT_BUDGET_REACHED" },
          domainCase: {
            repositorySnapshotId: "snap-1",
            ruleSetVersionId: "ver-1",
            repositoryScanJobId: "job-1",
            repositoryCommit: "sha-1",
            ruleSet: { lifecycleState: "ACTIVE" },
          },
        }),
      },
      repositorySnapshot: {
        findUnique: jest.fn<() => Promise<any>>().mockResolvedValue({
          id: "snap-1",
          assessmentId: "assessment",
          commitSha: "sha-1",
        }),
      },
      assessmentHumanRequest: {
        count: jest.fn<() => Promise<number>>().mockResolvedValue(0),
      },
    };
    const controls = new AssessmentRuntimeControlService(
      {
        $transaction: async (work: (value: typeof tx) => Promise<unknown>) =>
          work(tx),
      } as unknown as PrismaService,
      { enqueue: jest.fn() } as unknown as OutboxRepository,
      {} as AssessmentLifecycleCoordinator,
    );

    await expect(
      controls.request({
        assessmentId: "assessment",
        actor: customerActor,
        correlationId: "corr-cust",
        action: Actions.resume,
        targetRunId: "stopped-run",
        budgetExtension: {
          version: 1,
          additionalModelCalls: 50,
          auditReason: "Unauthorized attempt",
        },
      }),
    ).rejects.toMatchObject({
      status: 403,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: SHARED_ERROR_CODES.forbidden,
        }),
      }),
    });
  });
});
