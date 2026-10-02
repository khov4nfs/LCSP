import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import { AUDIT_ACTOR_TYPES } from "@lcsp/contracts/audit";
import { ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES } from "@lcsp/contracts/evidence";
import { HttpException } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import {
  EvidenceAcceptanceStatus,
  RepositoryScanJobStatus,
} from "@prisma/client";

import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import type { AssessmentPipelineContinuationService } from "./assessment-pipeline-continuation.service.js";
import { AssessmentPipelineReconciliationService } from "./assessment-pipeline-reconciliation.service.js";

describe("AssessmentPipelineReconciliationService", () => {
  const findMany = jest.fn<
    (...args: unknown[]) => Promise<
      Array<{
        id: string;
        technicalEvidenceReports: Array<{ scanJobId: string }>;
        repositoryScanJobs: Array<{ id: string }>;
      }>
    >
  >();
  const createMany =
    jest.fn<(...args: unknown[]) => Promise<{ count: number }>>();
  const updateMany =
    jest.fn<(...args: unknown[]) => Promise<{ count: number }>>();
  const continuePipeline = jest.fn<(...args: unknown[]) => Promise<unknown>>();
  const isStoppedByCustomer =
    jest.fn<(...args: unknown[]) => Promise<boolean>>();
  const config = {
    get: jest.fn<(key: string, fallback: number | boolean) => number | boolean>(
      (_key, fallback) => fallback,
    ),
  };
  let service: AssessmentPipelineReconciliationService;

  beforeEach(() => {
    jest.clearAllMocks();
    findMany.mockResolvedValue([
      {
        id: "assessment-1",
        technicalEvidenceReports: [{ scanJobId: "scan-1" }],
        repositoryScanJobs: [{ id: "scan-1" }],
      },
    ]);
    createMany.mockResolvedValue({ count: 1 });
    updateMany.mockResolvedValue({ count: 1 });
    continuePipeline.mockResolvedValue({});
    isStoppedByCustomer.mockResolvedValue(false);
    service = new AssessmentPipelineReconciliationService(
      {
        assessment: { findMany },
        pipelineReconciliation: { createMany, updateMany },
      } as unknown as PrismaService,
      config as unknown as ConfigService,
      {
        continuePipeline,
        isStoppedByCustomer,
      } as unknown as AssessmentPipelineContinuationService,
    );
  });

  it("never resumes a pipeline the customer stopped", async () => {
    isStoppedByCustomer.mockResolvedValue(true);

    await service.poll();

    expect(isStoppedByCustomer).toHaveBeenCalledWith("assessment-1");
    expect(continuePipeline).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it("selects only quiet unfinished assessments with accepted evidence and no active scan", async () => {
    await service.poll();
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: { notIn: expect.any(Array) },
          updatedAt: { lte: expect.any(Date) },
          technicalEvidenceReports: {
            some: { status: EvidenceAcceptanceStatus.ACCEPTED },
            none: { createdAt: { gt: expect.any(Date) } },
          },
          runtimeEvents: { none: { createdAt: { gt: expect.any(Date) } } },
          repositoryScanJobs: {
            none: {
              status: {
                notIn: [
                  RepositoryScanJobStatus.COMPLETED,
                  RepositoryScanJobStatus.FAILED,
                  RepositoryScanJobStatus.BLOCKED,
                ],
              },
            },
          },
        }),
        take: 50,
      }),
    );
    expect(continuePipeline).toHaveBeenCalledWith(
      expect.objectContaining({
        assessmentId: "assessment-1",
        actorType: AUDIT_ACTOR_TYPES.service,
        actor: expect.objectContaining({
          userId: "assessment-pipeline-reconciliation",
        }),
      }),
    );
  });

  it("does not replay accepted evidence from an older scan", async () => {
    findMany.mockResolvedValue([
      {
        id: "assessment-1",
        technicalEvidenceReports: [{ scanJobId: "scan-1" }],
        repositoryScanJobs: [{ id: "scan-2" }],
      },
    ]);
    await service.poll();
    expect(createMany).not.toHaveBeenCalled();
    expect(continuePipeline).not.toHaveBeenCalled();
  });

  it.each([
    ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.alreadyRunning,
    ASSESSMENT_PIPELINE_CONTINUE_PROBLEM_CODES.waitingForCustomer,
  ])("does not spend an attempt for %s", async (code) => {
    continuePipeline.mockRejectedValue(
      new HttpException({ ok: false, problem: { code } }, 409),
    );
    await service.poll();
    expect(updateMany).toHaveBeenCalledTimes(2);
    expect(updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({
        data: { attemptCount: { decrement: 1 }, lastAttemptAt: null },
      }),
    );
  });

  it("stops once the durable attempt cap is reached", async () => {
    updateMany.mockResolvedValue({ count: 0 });
    await service.poll();
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ attemptCount: { lt: 3 } }),
      }),
    );
    expect(continuePipeline).not.toHaveBeenCalled();
  });

  it("counts a downstream failure and leaves the next try behind the cooldown", async () => {
    continuePipeline.mockRejectedValue(new Error("downstream unavailable"));
    await service.poll();
    expect(updateMany).toHaveBeenCalledTimes(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { lastAttemptAt: null },
            { lastAttemptAt: { lte: expect.any(Date) } },
          ],
        }),
      }),
    );
  });
});
