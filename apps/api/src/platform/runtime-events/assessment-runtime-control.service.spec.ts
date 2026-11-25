import { describe, expect, it, jest } from "@jest/globals";
import { createHash } from "node:crypto";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AUDIT_ACTOR_TYPES,
  AUDIT_DECISIONS,
  AUDIT_EVENT_SCHEMA_VERSION,
  AUDIT_REDACTION_STATUSES,
  AUDIT_RESOURCE_TYPES,
} from "@lcsp/contracts/audit";
import { SHARED_ERROR_CODES } from "@lcsp/contracts/shared";
import {
  ASSESSMENT_ROOT_BOUNDARY,
  ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES,
  ASSESSMENT_DOMAIN_ERROR_CODES,
} from "@lcsp/contracts/assessment-domain";
import {
  ASSESSMENT_BUDGET_EXTENSION_SOURCES,
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS as Actions,
  ASSESSMENT_RUNTIME_CONTROL_PROBLEM_CODES as Problems,
  ASSESSMENT_RUNTIME_CONTROL_STATES as States,
} from "@lcsp/contracts/evidence";
import type { AuditEvent as PrismaAuditEvent } from "@prisma/client";
import type { PrismaService } from "../../infrastructure/prisma/prisma.service.js";
import type { OutboxRepository } from "../outbox/outbox.repository.js";
import type { AuditWriterService } from "../audit/audit-writer.service.js";
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
    const auditEventCreate = jest
      .fn<(args?: any) => Promise<Partial<PrismaAuditEvent>>>()
      .mockResolvedValue({ id: "audit-1" });
    const auditEventUpsert = jest
      .fn<(args?: any) => Promise<Partial<PrismaAuditEvent>>>()
      .mockResolvedValue({ id: "audit-1" });
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
      auditEvent: {
        create: auditEventCreate,
        upsert: auditEventUpsert,
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

    const requestPayload = {
      assessmentId: "assessment",
      actor: adminActor,
      correlationId: "corr-admin",
      action: Actions.resume,
      targetRunId: "stopped-run",
      idempotencyKey: "idem-v1",
      expectedVersion: 0,
      budgetExtension: {
        version: 1,
        additionalModelCalls: 50,
        auditReason: "Admin extended assessment budget by 50 model calls",
      },
    } as Parameters<typeof controls.request>[0] & {
      idempotencyKey: string;
      expectedVersion: number;
    };
    const result = await controls.request(requestPayload);

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
            idempotencyKey: "idem-v1",
          }),
        }),
      },
    });
    const expectedAuditId = `audit:${createHash("sha256")
      .update("budget-override:assessment:idem-v1")
      .digest("hex")}`;
    expect(auditEventUpsert).toHaveBeenCalledWith({
      where: { id: expectedAuditId },
      update: {},
      create: expect.objectContaining({
        id: expectedAuditId,
        eventType: ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES.BUDGET_OVERRIDE_AUTHORIZED,
        actorId: "admin-user",
        resourceType: AUDIT_RESOURCE_TYPES.assessment,
        resourceId: "assessment",
        reasonCode: ASSESSMENT_BUDGET_EXTENSION_SOURCES.adminOverride,
        decision: AUDIT_DECISIONS.allow,
        payload: expect.objectContaining({
          schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
          actor: { id: "admin-user", type: AUDIT_ACTOR_TYPES.user },
          redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
          result: ASSESSMENT_BUDGET_EXTENSION_SOURCES.adminOverride,
          idempotencyKey: "idem-v1",
          auditReason: "Admin extended assessment budget by 50 model calls",
        }),
      }),
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

  it("rejects stale or duplicate budgetExtension with version <= existing version", async () => {
    const adminActor = {
      userId: "admin-user",
      sessionId: "session-admin",
      role: AUTH_USER_ROLES.admin,
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
        updateMany: jest
          .fn<(args?: any) => Promise<{ count: number }>>()
          .mockResolvedValue({ count: 1 }),
      },
      assessment: {
        findUniqueOrThrow: jest.fn<() => Promise<any>>().mockResolvedValue({
          id: "assessment",
          lifecycleState: "PAUSED",
          runtime: { executionState: "PAUSED", checkpointId: "cp-1" },
          blockerReference: {
            reason: "AGENT_BUDGET_REACHED",
            budgetExtension: {
              version: 2,
              authorizedBy: "admin-1",
              authorizedAt: "2026-11-14T10:00:00.000Z",
              additionalModelCalls: 20,
            },
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
      { enqueue: jest.fn() } as unknown as OutboxRepository,
      {} as AssessmentLifecycleCoordinator,
    );

    // Stale/duplicate version 2 when version 2 already exists
    await expect(
      controls.request({
        assessmentId: "assessment",
        actor: adminActor,
        correlationId: "corr-stale",
        action: Actions.resume,
        targetRunId: "stopped-run",
        budgetExtension: {
          version: 2,
          additionalModelCalls: 30,
          auditReason: "Duplicate version attempt",
        },
      }),
    ).rejects.toMatchObject({
      status: 409,
    });

    // Stale version 1 when version 2 already exists
    await expect(
      controls.request({
        assessmentId: "assessment",
        actor: adminActor,
        correlationId: "corr-stale-lower",
        action: Actions.resume,
        targetRunId: "stopped-run",
        budgetExtension: {
          version: 1,
          additionalModelCalls: 30,
          auditReason: "Lower version attempt",
        },
      }),
    ).rejects.toMatchObject({
      status: 409,
    });
  });

  it("preserves version and authorization lineage across repeated valid extensions", async () => {
    const adminActor = {
      userId: "admin-user",
      sessionId: "session-admin",
      role: AUTH_USER_ROLES.admin,
      scope: null,
    };
    const queryRaw = jest.fn<() => Promise<unknown[]>>();
    queryRaw.mockResolvedValue([
      { id: "assessment", ownerId: "cust-1" },
      { assessmentId: "assessment" },
    ]);
    const updateAssessment = jest
      .fn<(args?: any) => Promise<unknown>>()
      .mockResolvedValue({});
    const auditEventUpsert = jest
      .fn<(args?: any) => Promise<Partial<PrismaAuditEvent>>>()
      .mockResolvedValue({ id: "audit-2" });
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
          blockerReference: {
            reason: "AGENT_BUDGET_REACHED",
            budgetExtension: {
              version: 1,
              authorizedBy: "admin-1",
              authorizedAt: "2026-11-14T10:00:00.000Z",
              additionalModelCalls: 20,
            },
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
      auditEvent: {
        create: jest.fn(),
        upsert: auditEventUpsert,
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

    // Submit valid version 2 > version 1 with matching expectedVersion
    const result = await controls.request({
      assessmentId: "assessment",
      actor: adminActor,
      correlationId: "corr-v2",
      action: Actions.resume,
      targetRunId: "stopped-run",
      idempotencyKey: "idem-v2",
      expectedVersion: 1,
      budgetExtension: {
        version: 2,
        additionalModelCalls: 30,
        auditReason: "Second extension",
      },
    } as Parameters<typeof controls.request>[0] & {
      idempotencyKey: string;
      expectedVersion: number;
    });

    expect(result.state).toBe(States.resumeRequested);
    expect(updateAssessment).toHaveBeenCalledWith({
      where: { id: "assessment" },
      data: {
        blockerReference: expect.objectContaining({
          budgetExtension: expect.objectContaining({
            version: 2,
            previousVersion: 1,
            additionalModelCalls: 30,
            idempotencyKey: "idem-v2",
          }),
          budgetExtensionHistory: expect.arrayContaining([
            expect.objectContaining({
              version: 1,
              additionalModelCalls: 20,
            }),
          ]),
        }),
      },
    });
    expect(auditEventUpsert).toHaveBeenCalledTimes(1);
  });

  it("replays idempotently on same idempotencyKey + same request fingerprint without duplicate extension or AuditEvent", async () => {
    const adminActor = {
      userId: "admin-user",
      sessionId: "session-admin",
      role: AUTH_USER_ROLES.admin,
      scope: null,
    };
    let storedBlockerReference: Record<string, unknown> = {
      reason: "AGENT_BUDGET_REACHED",
    };
    let currentTurnState: string = States.stopped;
    let currentTurnRequestId: string | null = "stop-request";

    const updateAssessment = jest.fn(async (args: { data: { blockerReference: Record<string, unknown> } }) => {
      storedBlockerReference = args.data.blockerReference;
      return {};
    });
    const updateManyTurns = jest.fn(async (args: { data: { state: string; requestId: string } }) => {
      currentTurnState = args.data.state;
      currentTurnRequestId = args.data.requestId;
      return { count: 1 };
    });
    const enqueue = jest.fn(async () => ({ id: "outbox-1" }));
    const writeInTx = jest.fn(async (_payload?: any, _tx?: any) => undefined);
    const auditWriterMock = { writeInTx } as unknown as AuditWriterService;

    const tx = {
      $queryRaw: jest
        .fn<() => Promise<unknown[]>>()
        .mockResolvedValue([
          { id: "assessment", ownerId: "cust-1" },
          { assessmentId: "assessment" },
        ]),
      assessmentRuntime: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          assessmentId: "assessment",
          threadId: "root-thread",
          checkpointNamespace: "assessment",
          currentExecutionId: "stopped-run",
        }),
      },
      assessmentRuntimeTurn: {
        findUnique: jest.fn(async () => ({
          id: "stopped-run",
          assessmentId: "assessment",
          threadId: "root-thread",
          boundary: ASSESSMENT_ROOT_BOUNDARY,
          logicalRunId: "logical-run",
          state: currentTurnState,
          requestId: currentTurnRequestId,
          checkpointJson: { checkpointId: "cp-1" },
        })),
        updateMany: updateManyTurns,
      },
      assessment: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: "assessment",
          lifecycleState: "PAUSED",
          runtime: { executionState: "PAUSED", checkpointId: "cp-1" },
          blockerReference: storedBlockerReference,
          domainCase: {
            repositorySnapshotId: "snap-1",
            ruleSetVersionId: "ver-1",
            repositoryScanJobId: "job-1",
            repositoryCommit: "sha-1",
            ruleSet: { lifecycleState: "ACTIVE" },
          },
        })),
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
      auditWriterMock,
    );

    const requestPayload = {
      assessmentId: "assessment",
      actor: adminActor,
      correlationId: "corr-idem-1",
      action: Actions.resume,
      targetRunId: "stopped-run",
      idempotencyKey: "idem-replay-key",
      expectedVersion: 0,
      budgetExtension: {
        version: 1,
        source: ASSESSMENT_BUDGET_EXTENSION_SOURCES.systemCompensation,
        additionalModelCalls: 25,
        auditReason: "Provider failure compensation",
      },
    } as Parameters<typeof controls.request>[0] & {
      idempotencyKey: string;
      expectedVersion: number;
    };

    const firstResult = await controls.request(requestPayload);
    expect(firstResult.state).toBe(States.resumeRequested);
    expect(writeInTx).toHaveBeenCalledTimes(1);
    expect(writeInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        idempotencyKey: "budget-override:assessment:idem-replay-key",
        eventType: ASSESSMENT_DOMAIN_AUDIT_EVENT_TYPES.BUDGET_OVERRIDE_AUTHORIZED,
        actorId: "admin-user",
        actor: { id: "admin-user", type: AUDIT_ACTOR_TYPES.user },
        assessmentId: "assessment",
        resourceType: AUDIT_RESOURCE_TYPES.assessment,
        resourceId: "assessment",
        reasonCode: ASSESSMENT_BUDGET_EXTENSION_SOURCES.systemCompensation,
        result: ASSESSMENT_BUDGET_EXTENSION_SOURCES.systemCompensation,
        redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
        payload: expect.objectContaining({
          schemaVersion: AUDIT_EVENT_SCHEMA_VERSION,
          actor: { id: "admin-user", type: AUDIT_ACTOR_TYPES.user },
          redactionStatus: AUDIT_REDACTION_STATUSES.redacted,
          result: ASSESSMENT_BUDGET_EXTENSION_SOURCES.systemCompensation,
          idempotencyKey: "idem-replay-key",
          auditReason: "Provider failure compensation",
        }),
      }),
      tx,
    );
    expect(updateAssessment).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);

    // Retry with identical idempotencyKey + identical payload + expectedVersion: 0
    const replayResult = await controls.request({
      ...requestPayload,
      correlationId: "corr-idem-retry",
    });
    expect(replayResult).toEqual(firstResult);
    expect(writeInTx).toHaveBeenCalledTimes(1);
    expect(updateAssessment).toHaveBeenCalledTimes(1);
    expect(updateManyTurns).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("rejects same idempotencyKey with different request fingerprint as 409 IDEMPOTENCY_CONFLICT", async () => {
    const adminActor = {
      userId: "admin-user",
      sessionId: "session-admin",
      role: AUTH_USER_ROLES.admin,
      scope: null,
    };
    let storedBlockerReference: Record<string, unknown> = {
      reason: "AGENT_BUDGET_REACHED",
    };
    let currentTurnState: string = States.stopped;
    const writeInTx = jest.fn(async () => undefined);
    const enqueue = jest.fn(async () => ({ id: "outbox-1" }));

    const tx = {
      $queryRaw: jest
        .fn<() => Promise<unknown[]>>()
        .mockResolvedValue([
          { id: "assessment", ownerId: "cust-1" },
          { assessmentId: "assessment" },
        ]),
      assessmentRuntime: {
        findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
          assessmentId: "assessment",
          threadId: "root-thread",
          checkpointNamespace: "assessment",
          currentExecutionId: "stopped-run",
        }),
      },
      assessmentRuntimeTurn: {
        findUnique: jest.fn(async () => ({
          id: "stopped-run",
          assessmentId: "assessment",
          threadId: "root-thread",
          boundary: ASSESSMENT_ROOT_BOUNDARY,
          logicalRunId: "logical-run",
          state: currentTurnState,
          requestId: "stop-request",
          checkpointJson: { checkpointId: "cp-1" },
        })),
        updateMany: jest.fn(async (args: { data: { state: string } }) => {
          currentTurnState = args.data.state;
          return { count: 1 };
        }),
      },
      assessment: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: "assessment",
          lifecycleState: "PAUSED",
          runtime: { executionState: "PAUSED", checkpointId: "cp-1" },
          blockerReference: storedBlockerReference,
          domainCase: {
            repositorySnapshotId: "snap-1",
            ruleSetVersionId: "ver-1",
            repositoryScanJobId: "job-1",
            repositoryCommit: "sha-1",
            ruleSet: { lifecycleState: "ACTIVE" },
          },
        })),
        update: jest.fn(async (args: { data: { blockerReference: Record<string, unknown> } }) => {
          storedBlockerReference = args.data.blockerReference;
          return {};
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
      { writeInTx } as unknown as AuditWriterService,
    );

    await controls.request({
      assessmentId: "assessment",
      actor: adminActor,
      correlationId: "corr-1",
      action: Actions.resume,
      targetRunId: "stopped-run",
      idempotencyKey: "idem-conflict-key",
      budgetExtension: {
        version: 1,
        additionalModelCalls: 25,
        auditReason: "Initial extension",
      },
    } as Parameters<typeof controls.request>[0] & { idempotencyKey: string });

    // Reuse same idempotencyKey with a mutated auditReason / quota
    await expect(
      controls.request({
        assessmentId: "assessment",
        actor: adminActor,
        correlationId: "corr-2",
        action: Actions.resume,
        targetRunId: "stopped-run",
        idempotencyKey: "idem-conflict-key",
        budgetExtension: {
          version: 1,
          additionalModelCalls: 100,
          auditReason: "Mutated extension attempt",
        },
      } as Parameters<typeof controls.request>[0] & { idempotencyKey: string }),
    ).rejects.toMatchObject({
      status: 409,
      response: expect.objectContaining({
        problem: expect.objectContaining({
          code: ASSESSMENT_DOMAIN_ERROR_CODES.IDEMPOTENCY_CONFLICT,
        }),
      }),
    });
    expect(writeInTx).toHaveBeenCalledTimes(1);
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it("rejects expectedVersion mismatch with 409 Conflict without writing AuditEvent or updating blockerReference", async () => {
    const adminActor = {
      userId: "admin-user",
      sessionId: "session-admin",
      role: AUTH_USER_ROLES.admin,
      scope: null,
    };
    const writeInTx = jest.fn(async () => undefined);
    const updateAssessment = jest.fn();
    const enqueue = jest.fn();

    const tx = {
      $queryRaw: jest
        .fn<() => Promise<unknown[]>>()
        .mockResolvedValue([
          { id: "assessment", ownerId: "cust-1" },
          { assessmentId: "assessment" },
        ]),
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
        updateMany: jest.fn(),
      },
      assessment: {
        findUniqueOrThrow: jest.fn<() => Promise<any>>().mockResolvedValue({
          id: "assessment",
          lifecycleState: "PAUSED",
          runtime: { executionState: "PAUSED", checkpointId: "cp-1" },
          blockerReference: {
            reason: "AGENT_BUDGET_REACHED",
            budgetExtension: {
              version: 1,
              authorizedBy: "admin-1",
              authorizedAt: "2026-11-14T10:00:00.000Z",
              additionalModelCalls: 20,
            },
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
      { writeInTx } as unknown as AuditWriterService,
    );

    await expect(
      controls.request({
        assessmentId: "assessment",
        actor: adminActor,
        correlationId: "corr-ver-mismatch",
        action: Actions.resume,
        targetRunId: "stopped-run",
        idempotencyKey: "idem-ver-mismatch",
        expectedVersion: 0, // Current version is 1
        budgetExtension: {
          version: 2,
          additionalModelCalls: 30,
          auditReason: "Stale expectedVersion",
        },
      } as Parameters<typeof controls.request>[0] & {
        idempotencyKey: string;
        expectedVersion: number;
      }),
    ).rejects.toMatchObject({ status: 409 });

    expect(writeInTx).not.toHaveBeenCalled();
    expect(updateAssessment).not.toHaveBeenCalled();
    expect(enqueue).not.toHaveBeenCalled();
  });
});
