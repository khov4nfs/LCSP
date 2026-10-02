import { describe, expect, it, jest } from "@jest/globals";
import { SCAN_ERROR_CODES } from "@lcsp/contracts/scan";

import { RequestTargetedReanalysisHandler } from "./request-targeted-reanalysis.handler.js";
import { RequestTargetedReanalysisCommand } from "./request-targeted-reanalysis.command.js";

describe("RequestTargetedReanalysisHandler admission", () => {
  it("locks the organization before counting rate and active capacity in the creation transaction", async () => {
    const requestCount = jest
      .fn()
      .mockImplementationOnce(() => Promise.resolve(0))
      .mockImplementationOnce(() => Promise.resolve(0))
      .mockImplementationOnce(() => Promise.resolve(0));
    const $executeRaw = jest.fn().mockImplementation(() => Promise.resolve());
    const transaction = {
      $executeRaw,
      targetedReanalysisRequest: {
        count: requestCount,
        create: jest
          .fn()
          .mockImplementation(() => Promise.resolve({ id: "request-1" })),
      },
      targetedReanalysisCheckpoint: {
        create: jest.fn().mockImplementation(() => Promise.resolve({})),
      },
      repositoryScanJob: {
        create: jest.fn().mockImplementation(() => Promise.resolve({})),
      },
    };
    const prisma = {
      targetedReanalysisRequest: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(null)),
      },
      technicalEvidenceReport: {
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "ter-1",
            snapshotId: "snapshot-1",
            evidencePayload: {},
          }),
        ),
      },
      repositorySnapshot: {
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "snapshot-1",
            commitSha: "commit-1",
          }),
        ),
      },
      $transaction: jest.fn((handler: (tx: typeof transaction) => unknown) =>
        Promise.resolve(handler(transaction)),
      ),
    };
    const outbox = {
      enqueue: jest.fn().mockImplementation(() => Promise.resolve()),
    };
    const auditWriter = {
      write: jest.fn().mockImplementation(() => Promise.resolve()),
    };
    const handler = new RequestTargetedReanalysisHandler(
      prisma as never,
      auditWriter as never,
      outbox as never,
    );

    await handler.execute(
      new RequestTargetedReanalysisCommand(
        {
          assessmentId: "assessment-1",
          inputArtifactVersion: "ter-1",
          analyzerId: "DEEP_AGENT_REPOSITORY_ANALYSIS",
          scope: {
            ruleScope: {
              engineeringRuleId: "ENG-1",
              criterionIds: ["criterion-b", "criterion-a"],
              contextRevision: 3,
            },
          },
          reasonRequirementId: "requirement:1",
          idempotencyKey: "idempotency-key-0001",
        },
        {
          userId: "user-1",
        } as never,
        "correlation-1",
      ),
    );

    expect($executeRaw).toHaveBeenCalledTimes(1);
    expect(requestCount).toHaveBeenCalledTimes(4);
    expect(prisma.targetedReanalysisRequest).not.toHaveProperty("count");
  });

  it("rejects a new request once the organization already has 10 queued requests", async () => {
    const requestCount = jest
      .fn()
      .mockImplementationOnce(() => Promise.resolve(0))
      .mockImplementationOnce(() => Promise.resolve(0))
      .mockImplementationOnce(() => Promise.resolve(11))
      .mockImplementationOnce(() => Promise.resolve(10));
    const transaction = {
      $executeRaw: jest.fn().mockImplementation(() => Promise.resolve()),
      targetedReanalysisRequest: {
        count: requestCount,
        create: jest.fn(),
      },
      targetedReanalysisCheckpoint: { create: jest.fn() },
      repositoryScanJob: { create: jest.fn() },
    };
    const prisma = {
      targetedReanalysisRequest: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(null)),
      },
      technicalEvidenceReport: {
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "ter-1",
            snapshotId: "snapshot-1",
            evidencePayload: {},
          }),
        ),
      },
      repositorySnapshot: {
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "snapshot-1",
            commitSha: "commit-1",
          }),
        ),
      },
      $transaction: jest.fn((handler: (tx: typeof transaction) => unknown) =>
        Promise.resolve(handler(transaction)),
      ),
    };
    const outbox = { enqueue: jest.fn() };
    const auditWriter = { write: jest.fn() };
    const handler = new RequestTargetedReanalysisHandler(
      prisma as never,
      auditWriter as never,
      outbox as never,
    );

    let caught: unknown;
    try {
      await handler.execute(
        new RequestTargetedReanalysisCommand(
          {
            assessmentId: "assessment-1",
            inputArtifactVersion: "ter-1",
            analyzerId: "DEEP_AGENT_REPOSITORY_ANALYSIS",
            scope: {
              ruleScope: {
                engineeringRuleId: "ENG-1",
                criterionIds: ["criterion-b", "criterion-a"],
                contextRevision: 3,
              },
            },
            reasonRequirementId: "requirement:1",
            idempotencyKey: "idempotency-key-queued-cap-0001",
          },
          {
            userId: "user-1",
          } as never,
          "correlation-1",
        ),
      );
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeDefined();
    expect(
      (
        caught as { getResponse: () => { problem?: { code?: string } } }
      ).getResponse().problem?.code,
    ).toBe(SCAN_ERROR_CODES.targetedReanalysisCapacityExhausted);

    expect(transaction.targetedReanalysisRequest.create).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
  it("queues a rule scope without needing any path or seed", async () => {
    const transaction = {
      $executeRaw: jest.fn().mockImplementation(() => Promise.resolve()),
      targetedReanalysisRequest: {
        count: jest.fn().mockImplementation(() => Promise.resolve(0)),
        create: jest
          .fn()
          .mockImplementation(() => Promise.resolve({ id: "request-rule" })),
      },
      targetedReanalysisCheckpoint: {
        create: jest.fn().mockImplementation(() => Promise.resolve({})),
      },
      repositoryScanJob: {
        create: jest.fn().mockImplementation(() => Promise.resolve({})),
      },
    };
    const prisma = {
      targetedReanalysisRequest: {
        findUnique: jest.fn().mockImplementation(() => Promise.resolve(null)),
      },
      technicalEvidenceReport: {
        // No file path anywhere in the artifact: only a task-id scope can work here.
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve({
            id: "ter-1",
            snapshotId: "snapshot-1",
            evidencePayload: {},
          }),
        ),
      },
      repositorySnapshot: {
        findFirst: jest
          .fn()
          .mockImplementation(() =>
            Promise.resolve({ id: "snapshot-1", commitSha: "commit-1" }),
          ),
      },
      $transaction: jest.fn((handler: (tx: typeof transaction) => unknown) =>
        Promise.resolve(handler(transaction)),
      ),
    };
    const outbox = {
      enqueue: jest.fn().mockImplementation(() => Promise.resolve()),
    };
    const auditWriter = {
      write: jest.fn().mockImplementation(() => Promise.resolve()),
    };
    const handler = new RequestTargetedReanalysisHandler(
      prisma as never,
      auditWriter as never,
      outbox as never,
    );

    const response = await handler.execute(
      new RequestTargetedReanalysisCommand(
        {
          assessmentId: "assessment-1",
          inputArtifactVersion: "ter-1",
          analyzerId: "DEEP_AGENT_REPOSITORY_ANALYSIS",
          scope: {
            ruleScope: {
              engineeringRuleId: "ENG-1",
              criterionIds: ["criterion-b", "criterion-a"],
              contextRevision: 3,
            },
          },
          reasonRequirementId: "requirement:CONTEXT_CONDITION_RESOLVED",
          idempotencyKey: "idempotency-key-rule-0001",
        },
        { userId: "user-1" } as never,
        "correlation-1",
      ),
    );

    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          normalizedScope: {
            ruleScope: {
              engineeringRuleId: "ENG-1",
              criterionIds: ["criterion-a", "criterion-b"],
              contextRevision: 3,
            },
          },
        }),
      }),
      transaction,
    );
    expect(response.toolVersion).toBe("3.0.0");
  });

  it("rejects a legacy path scope", async () => {
    const handler = new RequestTargetedReanalysisHandler(
      {} as never,
      {} as never,
      {} as never,
    );
    let caught: unknown;
    try {
      await handler.execute(
        new RequestTargetedReanalysisCommand(
          {
            assessmentId: "assessment-1",
            inputArtifactVersion: "ter-1",
            analyzerId: "DEEP_AGENT_REPOSITORY_ANALYSIS",
            scope: { pathPrefixes: ["src/"] } as never,
            reasonRequirementId: "requirement:1",
            idempotencyKey: "idempotency-key-mixed-0001",
          },
          { userId: "user-1" } as never,
          "correlation-1",
        ),
      );
    } catch (error) {
      caught = error;
    }
    expect(
      (
        caught as { getResponse: () => { problem?: { code?: string } } }
      ).getResponse().problem?.code,
    ).toBe(SCAN_ERROR_CODES.targetedReanalysisInvalidScope);
  });
});
