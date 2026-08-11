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
        findFirst: jest.fn().mockResolvedValue({ id: "ter-1" }),
      },
      repositorySnapshot: {
        findFirst: jest.fn().mockResolvedValue({ id: "snapshot-1" }),
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
          inputEvidenceReportId: "ter-1",
          snapshotId: "snapshot-1",
          commitSha: "commit-1",
          analyzerId: "RUN_PYTHON_SEMANTIC_ANALYSIS",
          pathPrefixes: ["src/"],
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
    expect(requestCount).toHaveBeenCalledTimes(3);
    expect(prisma.targetedReanalysisRequest).not.toHaveProperty("count");
  });
});
