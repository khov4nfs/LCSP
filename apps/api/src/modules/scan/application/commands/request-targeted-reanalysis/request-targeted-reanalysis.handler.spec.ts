import { describe, expect, it, jest } from "@jest/globals";

import { RequestTargetedReanalysisHandler } from "./request-targeted-reanalysis.handler.js";
import { RequestTargetedReanalysisCommand } from "./request-targeted-reanalysis.command.js";

describe("RequestTargetedReanalysisHandler admission", () => {
  it("locks the organization before counting rate and active capacity in the creation transaction", async () => {
    const requestCount = jest
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0);
    const $executeRaw = jest.fn().mockResolvedValue(undefined);
    const transaction = {
      $executeRaw,
      targetedReanalysisRequest: {
        count: requestCount,
        create: jest.fn().mockResolvedValue({ id: "request-1" }),
      },
      targetedReanalysisCheckpoint: { create: jest.fn().mockResolvedValue({}) },
      repositoryScanJob: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      targetedReanalysisRequest: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "ter-1",
          snapshotId: "snapshot-1",
          evidencePayload: {},
        }),
      },
      repositorySnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          id: "snapshot-1",
          commitSha: "commit-1",
        }),
      },
      $transaction: jest.fn((handler: (tx: typeof transaction) => unknown) =>
        Promise.resolve(handler(transaction)),
      ),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const auditWriter = { write: jest.fn().mockResolvedValue(undefined) };
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
          analyzerId: "RUN_PYTHON_SEMANTIC_ANALYSIS",
          scope: { pathPrefixes: ["src/"] },
          reasonRequirementId: "requirement:1",
          idempotencyKey: "idempotency-key-0001",
        },
        {
          userId: "user-1",
          organizationId: "org-1",
        } as never,
        "correlation-1",
      ),
    );

    expect($executeRaw).toHaveBeenCalledTimes(1);
    expect(requestCount).toHaveBeenCalledTimes(4);
    expect(prisma.targetedReanalysisRequest).not.toHaveProperty("count");
  });

  it("resolves subject references to safe paths from the pinned evidence report", async () => {
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      targetedReanalysisRequest: {
        count: jest.fn().mockResolvedValue(0),
        create: jest.fn().mockResolvedValue({ id: "request-subject" }),
      },
      targetedReanalysisCheckpoint: { create: jest.fn().mockResolvedValue({}) },
      repositoryScanJob: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      targetedReanalysisRequest: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "ter-1",
          snapshotId: "snapshot-1",
          evidencePayload: {
            technical_findings: [
              { finding_id: "finding-12345678", file_path: "repo/src/ai.py" },
            ],
          },
        }),
      },
      repositorySnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          id: "snapshot-1",
          commitSha: "commit-1",
        }),
      },
      $transaction: jest.fn((handler: (tx: typeof transaction) => unknown) =>
        Promise.resolve(handler(transaction)),
      ),
    };
    const outbox = { enqueue: jest.fn().mockResolvedValue(undefined) };
    const auditWriter = { write: jest.fn().mockResolvedValue(undefined) };
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
          analyzerId: "RUN_PYTHON_SEMANTIC_ANALYSIS",
          scope: { subjectRefs: ["finding:finding-12345678"] },
          reasonRequirementId: "requirement:1",
          idempotencyKey: "idempotency-key-subject-0001",
        },
        { userId: "user-1", organizationId: "org-1" } as never,
        "correlation-1",
      ),
    );

    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          normalizedScope: { pathPrefixes: ["repo/src/"] },
        }),
      }),
      transaction,
    );
  });

  it("rejects a new request once the organization already has 10 queued requests", async () => {
    const requestCount = jest
      .fn()
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(0)
      .mockResolvedValueOnce(11)
      .mockResolvedValueOnce(10);
    const transaction = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      targetedReanalysisRequest: {
        count: requestCount,
        create: jest.fn(),
      },
      targetedReanalysisCheckpoint: { create: jest.fn() },
      repositoryScanJob: { create: jest.fn() },
    };
    const prisma = {
      targetedReanalysisRequest: {
        findUnique: jest.fn().mockResolvedValue(null),
      },
      technicalEvidenceReport: {
        findFirst: jest.fn().mockResolvedValue({
          id: "ter-1",
          snapshotId: "snapshot-1",
          evidencePayload: {},
        }),
      },
      repositorySnapshot: {
        findFirst: jest.fn().mockResolvedValue({
          id: "snapshot-1",
          commitSha: "commit-1",
        }),
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
            analyzerId: "RUN_PYTHON_SEMANTIC_ANALYSIS",
            scope: { pathPrefixes: ["src/"] },
            reasonRequirementId: "requirement:1",
            idempotencyKey: "idempotency-key-queued-cap-0001",
          },
          {
            userId: "user-1",
            organizationId: "org-1",
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
    ).toBe("TENANT_REANALYSIS_CAPACITY_EXHAUSTED");

    expect(transaction.targetedReanalysisRequest.create).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
