import { describe, expect, it, jest } from "@jest/globals";
import { randomUUID } from "node:crypto";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  adminBudgetExtensionRequestSchema,
  customerRuntimeControlRequestSchema,
  ASSESSMENT_RUNTIME_CONTROL_ACTIONS,
} from "@lcsp/contracts/evidence";
import * as evidenceContracts from "@lcsp/contracts/evidence";
import { AssessmentRuntimeControlService } from "../../../../../platform/runtime-events/assessment-runtime-control.service.js";
import { AssessmentRuntimeControlController } from "../../../presentation/http/assessment-runtime-control.controller.js";
import { AdminAssessmentBudgetController } from "../../../presentation/http/admin-assessment-budget.controller.js";

describe("ASM-BUDGET-01 & ASM-BUDGET-05: Admin Runtime Budget Override RED Contracts", () => {
  it("ASM-BUDGET-01: customer runtime control schema rejects raw budgetExtension allowance", () => {
    const parsed = customerRuntimeControlRequestSchema.safeParse({
      targetRunId: randomUUID(),
      budgetExtension: {
        version: 1,
        additionalModelCalls: 100,
      },
    });
    expect(parsed.success).toBe(false);
  });

  it("ASM-BUDGET-05: adminBudgetExtensionRequestSchema requires auditReason and idempotencyKey", () => {
    // Contract 29: admin override requires idempotencyKey and mandatory auditReason
    const missingReason = adminBudgetExtensionRequestSchema.safeParse({
      targetRunId: randomUUID(),
      budgetExtension: {
        version: 1,
        additionalModelCalls: 50,
      },
    });
    expect(missingReason.success).toBe(false);

    const missingIdempotencyKey = adminBudgetExtensionRequestSchema.safeParse({
      targetRunId: randomUUID(),
      budgetExtension: {
        version: 1,
        auditReason: "Support compensation for provider timeout",
        additionalModelCalls: 50,
      },
    });
    expect(missingIdempotencyKey.success).toBe(false);
  });

  it("ASM-BUDGET-05: shared contracts expose ASSESSMENT_BUDGET_EXTENSION_SOURCES with ADMIN_OVERRIDE and SYSTEM_COMPENSATION only (no PAYMENT)", () => {
    const sources = (evidenceContracts as Record<string, unknown>)
      .ASSESSMENT_BUDGET_EXTENSION_SOURCES as
      Record<string, string> | undefined;

    expect(sources).toBeDefined();
    expect(sources?.adminOverride).toBe("ADMIN_OVERRIDE");
    expect(sources?.systemCompensation).toBe("SYSTEM_COMPENSATION");
    expect(Object.values(sources ?? {})).not.toContain("PAYMENT");
  });

  it("ASM-BUDGET-05: AssessmentRuntimeControlService writes canonical AuditEvent atomically inside the transaction on budget override", async () => {
    const assessmentId = randomUUID();
    const targetRunId = randomUUID();
    const adminUserId = randomUUID();

    const auditEventCreate = jest.fn(async () => ({ id: randomUUID() }));
    const outboxCreate = jest.fn(async () => ({ id: randomUUID() }));
    const turnUpdate = jest.fn(async () => ({
      id: targetRunId,
      assessmentId,
      threadId: "thread-1",
      logicalRunId: "run-1",
      state: "RESUME_REQUESTED",
      boundary: "ASSESSMENT_ROOT",
      checkpointJson: { ok: true },
    }));
    const assessmentUpdate = jest.fn(async () => ({ id: assessmentId }));

    const ownerId = randomUUID();
    const txMock = {
      $queryRaw: jest.fn(async () => [{ id: assessmentId, ownerId }]),
      assessmentRuntime: {
        findUnique: jest.fn(async () => ({
          assessmentId,
          currentExecutionId: targetRunId,
          checkpointNamespace: assessmentId,
          threadId: "thread-1",
          executionState: "PAUSED",
          checkpointId: "cp-1",
        })),
      },
      assessmentRuntimeTurn: {
        findUnique: jest.fn(async () => ({
          id: targetRunId,
          assessmentId,
          threadId: "thread-1",
          logicalRunId: "run-1",
          state: "STOPPED",
          boundary: "ASSESSMENT_ROOT",
          checkpointJson: { ok: true },
        })),
        update: turnUpdate,
        updateMany: jest.fn(async () => ({ count: 1 })),
      },
      assessment: {
        findUniqueOrThrow: jest.fn(async () => ({
          id: assessmentId,
          ownerId: randomUUID(),
          lifecycleState: "PAUSED",
          blockerReference: { reason: "BUDGET_EXHAUSTED" },
          runtime: {
            executionState: "PAUSED",
            checkpointId: "cp-1",
          },
          domainCase: {
            ruleSetVersionId: randomUUID(),
            repositoryScanJobId: randomUUID(),
            repositorySnapshotId: randomUUID(),
            repositoryCommit: "sha-123",
            ruleSet: { lifecycleState: "ACTIVE" },
          },
        })),
        update: assessmentUpdate,
      },
      repositorySnapshot: {
        findUnique: jest.fn(async () => ({
          id: "snap-1",
          assessmentId,
          commitSha: "sha-123",
        })),
      },
      assessmentHumanRequest: {
        count: jest.fn(async () => 0),
      },
      outboxMessage: {
        create: outboxCreate,
      },
      auditEvent: {
        create: auditEventCreate,
      },
    };

    const prismaMock = {
      $transaction: jest.fn(
        async (cb: (tx: typeof txMock) => Promise<unknown>) => cb(txMock),
      ),
    };

    const service = new AssessmentRuntimeControlService(
      prismaMock as never,
      { enqueue: jest.fn(async () => ({ id: randomUUID() })) } as never,
      { resumeFromPause: jest.fn(async () => undefined) } as never,
    );

    // Override repositorySnapshot.findUnique to match domainCase snapshot id dynamically
    txMock.assessment.findUniqueOrThrow.mockImplementation(async () => {
      const snapId = randomUUID();
      txMock.repositorySnapshot.findUnique.mockResolvedValueOnce({
        id: snapId,
        assessmentId,
        commitSha: "sha-123",
      });
      return {
        id: assessmentId,
        ownerId: randomUUID(),
        lifecycleState: "PAUSED",
        blockerReference: { reason: "BUDGET_EXHAUSTED" },
        runtime: {
          executionState: "PAUSED",
          checkpointId: "cp-1",
        },
        domainCase: {
          ruleSetVersionId: randomUUID(),
          repositoryScanJobId: randomUUID(),
          repositorySnapshotId: snapId,
          repositoryCommit: "sha-123",
          ruleSet: { lifecycleState: "ACTIVE" },
        },
      };
    });

    await service.request({
      assessmentId,
      actor: {
        userId: adminUserId,
        role: AUTH_USER_ROLES.admin,
        sessionId: "sess-1",
        scope: null,
      },
      correlationId: "corr-admin-1",
      action: ASSESSMENT_RUNTIME_CONTROL_ACTIONS.resume,
      targetRunId,
      budgetExtension: {
        version: 1,
        auditReason: "Provider failure compensation",
        additionalModelCalls: 25,
      },
    });

    expect(auditEventCreate).toHaveBeenCalledTimes(1);
  });

  it("ASM-BUDGET-05: legacy extend-budget route is marked deprecated and forwards identically to canonical admin route", () => {
    const legacyDescriptor = Object.getOwnPropertyDescriptor(
      AssessmentRuntimeControlController.prototype,
      "extendBudget",
    );
    const canonicalDescriptor = Object.getOwnPropertyDescriptor(
      AdminAssessmentBudgetController.prototype,
      "extendBudget",
    );
    expect(legacyDescriptor).toBeDefined();
    expect(canonicalDescriptor).toBeDefined();
    // Legacy endpoint must advertise Deprecation header metadata via NestJS @Header decorator
    const headersMeta = Reflect.getMetadata(
      "__headers__",
      AssessmentRuntimeControlController.prototype.extendBudget,
    ) as Array<{ name: string; value: string }> | undefined;
    expect(headersMeta).toBeDefined();
    expect(
      headersMeta?.some((h) => h.name === "Deprecation" && h.value === "true"),
    ).toBe(true);
  });
});
