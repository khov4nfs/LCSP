import { beforeEach, describe, expect, it, jest } from "@jest/globals";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";
import { Test, type TestingModule } from "@nestjs/testing";

import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { RerunScanCommand } from "./rerun-scan.command.js";
import { RerunScanHandler } from "./rerun-scan.handler.js";

describe("RerunScanHandler", () => {
  let handler: RerunScanHandler;
  let prisma: jest.Mocked<PrismaService>;
  let auditWriter: jest.Mocked<AuditWriterService>;
  let outbox: jest.Mocked<OutboxRepository>;

  const defaultRbac = {
    userId: "user-1",
    sessionId: "sess",
    role: AUTH_USER_ROLES.customer,
    scope: "assessment-1",
  };

  const defaultCommand = new RerunScanCommand(
    "assessment-1",
    "snapshot-1",
    "idempotency-key",
    defaultRbac,
    "corr-id",
    "reason",
  );

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RerunScanHandler,
        {
          provide: PrismaService,
          useValue: {
            aIUsageFlow: {
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            assessmentRuntimeEvent: {
              findFirst: jest.fn(),
              deleteMany: jest.fn(),
            },
            repositoryScanJob: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              findMany: jest.fn(),
              updateMany: jest.fn(),
              create: jest.fn(),
              deleteMany: jest.fn(),
            },
            repositorySnapshot: {
              findUnique: jest.fn(),
            },
            assessment: {
              findUnique: jest.fn(),
            },
            classificationResult: {
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            classificationReviewRequest: {
              deleteMany: jest.fn(),
            },
            conflictRecord: {
              deleteMany: jest.fn(),
            },
            documentRequest: {
              deleteMany: jest.fn(),
            },
            legalRuleMatch: {
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            outboxMessage: {
              deleteMany: jest.fn(),
            },
            readinessExport: {
              deleteMany: jest.fn(),
            },
            targetedReanalysisCheckpoint: {
              deleteMany: jest.fn(),
            },
            targetedReanalysisRequest: {
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            technicalEvidenceReport: {
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            technicalProfile: {
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            verifiedProfile: {
              findMany: jest.fn(),
              deleteMany: jest.fn(),
            },
            $transaction: jest.fn((cb: (tx: PrismaService) => unknown) =>
              cb(prisma),
            ),
          },
        },
        {
          provide: AuditWriterService,
          useValue: {
            write: jest.fn(),
          },
        },
        {
          provide: OutboxRepository,
          useValue: {
            enqueue: jest.fn(),
          },
        },
      ],
    }).compile();

    handler = module.get<RerunScanHandler>(RerunScanHandler);
    prisma = module.get(PrismaService);
    auditWriter = module.get(AuditWriterService);
    outbox = module.get(OutboxRepository);

    (
      prisma.assessmentRuntimeEvent.findFirst as jest.Mock<any>
    ).mockResolvedValue(null);
    (prisma.repositoryScanJob.findMany as jest.Mock<any>).mockResolvedValue([]);
    (prisma.repositoryScanJob.updateMany as jest.Mock<any>).mockResolvedValue({
      count: 0,
    });
    (
      prisma.technicalEvidenceReport.findMany as jest.Mock<any>
    ).mockResolvedValue([]);
    (prisma.technicalProfile.findMany as jest.Mock<any>).mockResolvedValue([]);
    (prisma.aIUsageFlow.findMany as jest.Mock<any>).mockResolvedValue([]);
    (prisma.verifiedProfile.findMany as jest.Mock<any>).mockResolvedValue([]);
    (prisma.legalRuleMatch.findMany as jest.Mock<any>).mockResolvedValue([]);
    (prisma.classificationResult.findMany as jest.Mock<any>).mockResolvedValue(
      [],
    );
    (
      prisma.targetedReanalysisRequest.findMany as jest.Mock<any>
    ).mockResolvedValue([]);
    (prisma.repositoryScanJob.deleteMany as jest.Mock<any>).mockResolvedValue({
      count: 0,
    });
    (
      prisma.technicalEvidenceReport.deleteMany as jest.Mock<any>
    ).mockResolvedValue({ count: 0 });
    (prisma.technicalProfile.deleteMany as jest.Mock<any>).mockResolvedValue({
      count: 0,
    });
    (prisma.aIUsageFlow.deleteMany as jest.Mock<any>).mockResolvedValue({
      count: 0,
    });
    (prisma.conflictRecord.deleteMany as jest.Mock<any>).mockResolvedValue({
      count: 0,
    });
    (prisma.verifiedProfile.deleteMany as jest.Mock<any>).mockResolvedValue({
      count: 0,
    });
    (prisma.legalRuleMatch.deleteMany as jest.Mock<any>).mockResolvedValue({
      count: 0,
    });
    (
      prisma.classificationResult.deleteMany as jest.Mock<any>
    ).mockResolvedValue({ count: 0 });
    (
      prisma.classificationReviewRequest.deleteMany as jest.Mock<any>
    ).mockResolvedValue({ count: 0 });
    (prisma.documentRequest.deleteMany as jest.Mock<any>).mockResolvedValue({
      count: 0,
    });
    (
      prisma.targetedReanalysisCheckpoint.deleteMany as jest.Mock<any>
    ).mockResolvedValue({ count: 0 });
    (
      prisma.targetedReanalysisRequest.deleteMany as jest.Mock<any>
    ).mockResolvedValue({ count: 0 });
    (prisma.outboxMessage.deleteMany as jest.Mock<any>).mockResolvedValue({
      count: 0,
    });
    (
      prisma.assessmentRuntimeEvent.deleteMany as jest.Mock<any>
    ).mockResolvedValue({ count: 0 });
    (prisma.readinessExport.deleteMany as jest.Mock<any>).mockResolvedValue({
      count: 0,
    });
  });

  it("throws BadRequestException if idempotencyKey is missing", async () => {
    const cmd = new RerunScanCommand(
      "assessment-1",
      "snapshot-1",
      "",
      defaultRbac,
      "corr",
    );
    await expect(handler.execute(cmd)).rejects.toThrow(BadRequestException);
  });

  it("[T02] returns existing job if idempotencyKey matches identically", async () => {
    (
      prisma.repositoryScanJob.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce({
      id: "job-1",
      status: REPOSITORY_SCAN_JOB_STATUSES.queued,
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
    });

    const result = await handler.execute(defaultCommand);
    expect(result.scan_job_id).toBe("job-1");
    expect(result.status).toBe(REPOSITORY_SCAN_JOB_STATUSES.queued);
  });

  it("throws ConflictException if idempotencyKey exists but fields mismatch", async () => {
    (
      prisma.repositoryScanJob.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce({
      id: "job-1",
      assessmentId: "diff-assessment",
    });

    await expect(handler.execute(defaultCommand)).rejects.toThrow(
      ConflictException,
    );
  });

  it("[T05] throws NotFoundException if snapshot not found", async () => {
    (
      prisma.repositoryScanJob.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce(null);
    (
      prisma.repositorySnapshot.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce(null);

    await expect(handler.execute(defaultCommand)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("throws NotFoundException if assessment not found", async () => {
    (
      prisma.repositoryScanJob.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce(null);
    (
      prisma.repositorySnapshot.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce({
      id: "snapshot-1",
      assessmentId: "assessment-1",
      commitSha: "a".repeat(40),
    });
    (prisma.assessment.findUnique as jest.Mock<any>).mockResolvedValueOnce(
      null,
    );

    await expect(handler.execute(defaultCommand)).rejects.toThrow(
      NotFoundException,
    );
  });

  it("[T04] throws ForbiddenException if user is not owner and is manager", async () => {
    (
      prisma.repositoryScanJob.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce(null);
    (
      prisma.repositorySnapshot.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce({
      id: "snapshot-1",
      assessmentId: "assessment-1",
      commitSha: "a".repeat(40),
    });
    (prisma.assessment.findUnique as jest.Mock<any>).mockResolvedValueOnce({
      id: "assessment-1",
      ownerId: "other-user",
      status: ASSESSMENT_STATUS_CODES.wizardSubmitted,
    });

    await expect(handler.execute(defaultCommand)).rejects.toThrow(
      ForbiddenException,
    );
  });

  it("throws ConflictException if assessment state is invalid", async () => {
    (
      prisma.repositoryScanJob.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce(null);
    (
      prisma.repositorySnapshot.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce({
      id: "snapshot-1",
      assessmentId: "assessment-1",
      commitSha: "a".repeat(40),
    });
    (prisma.assessment.findUnique as jest.Mock<any>).mockResolvedValueOnce({
      id: "assessment-1",
      ownerId: "user-1",
      status: "INVALID_STATE",
    });

    await expect(handler.execute(defaultCommand)).rejects.toThrow(
      ConflictException,
    );
  });

  it("[T01] creates new scan job, enqueues commit-pinned event, and writes audit", async () => {
    (
      prisma.repositoryScanJob.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce(null);
    (
      prisma.repositorySnapshot.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce({
      id: "snapshot-1",
      assessmentId: "assessment-1",
      commitSha: "a".repeat(40),
    });
    (prisma.assessment.findUnique as jest.Mock<any>).mockResolvedValueOnce({
      id: "assessment-1",
      ownerId: "user-1",
      status: ASSESSMENT_STATUS_CODES.wizardSubmitted,
    });

    (
      prisma.repositoryScanJob.findFirst as jest.Mock<any>
    ).mockResolvedValueOnce(null);
    (
      prisma.repositoryScanJob.findFirst as jest.Mock<any>
    ).mockResolvedValueOnce({
      id: "prior-job",
    });

    const result = await handler.execute(defaultCommand);

    expect(result.status).toBe(REPOSITORY_SCAN_JOB_STATUSES.queued);
    expect(result.replaces_scan_job_id).toBe("prior-job");

    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.$transaction).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.repositoryScanJob.create).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(outbox.enqueue).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          snapshotId: "snapshot-1",
          commitSha: "a".repeat(40),
        }),
      }),
      expect.anything(),
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(auditWriter.write).toHaveBeenCalled();
  });

  it("throws ConflictException when a scan is already active", async () => {
    (
      prisma.repositoryScanJob.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce(null);
    (
      prisma.repositorySnapshot.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce({
      id: "snapshot-1",
      assessmentId: "assessment-1",
      commitSha: "a".repeat(40),
    });
    (prisma.assessment.findUnique as jest.Mock<any>).mockResolvedValueOnce({
      id: "assessment-1",
      ownerId: "user-1",
      status: ASSESSMENT_STATUS_CODES.wizardSubmitted,
    });
    (
      prisma.repositoryScanJob.findFirst as jest.Mock<any>
    ).mockResolvedValueOnce({ id: "active-job" });

    await expect(handler.execute(defaultCommand)).rejects.toThrow(
      ConflictException,
    );
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.repositoryScanJob.create).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("fails stale active scans before creating a rerun", async () => {
    (
      prisma.repositoryScanJob.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce(null);
    (
      prisma.repositorySnapshot.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce({
      id: "snapshot-1",
      assessmentId: "assessment-1",
      commitSha: "a".repeat(40),
    });
    (prisma.assessment.findUnique as jest.Mock<any>).mockResolvedValueOnce({
      id: "assessment-1",
      ownerId: "user-1",
      status: ASSESSMENT_STATUS_CODES.wizardSubmitted,
    });
    (prisma.repositoryScanJob.findMany as jest.Mock<any>)
      .mockResolvedValueOnce([
        {
          id: "stale-job",
          updatedAt: new Date(Date.now() - 10 * 60 * 1000),
        },
      ])
      .mockResolvedValueOnce([{ id: "stale-job" }]);
    (
      prisma.assessmentRuntimeEvent.findFirst as jest.Mock<any>
    ).mockResolvedValueOnce(null);
    (
      prisma.repositoryScanJob.findFirst as jest.Mock<any>
    ).mockResolvedValueOnce(null);
    (
      prisma.repositoryScanJob.findFirst as jest.Mock<any>
    ).mockResolvedValueOnce({ id: "stale-job" });

    const result = await handler.execute(defaultCommand);

    expect(result.status).toBe(REPOSITORY_SCAN_JOB_STATUSES.queued);
    expect(result.replaces_scan_job_id).toBe("stale-job");
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.repositoryScanJob.updateMany).toHaveBeenCalledWith({
      where: { id: { in: ["stale-job"] } },
      data: expect.objectContaining({
        status: REPOSITORY_SCAN_JOB_STATUSES.failed,
      }),
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.repositoryScanJob.create).toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(outbox.enqueue).toHaveBeenCalled();
  });

  it("deletes prior scan and evidence artifacts for the same snapshot before rerun", async () => {
    (
      prisma.repositoryScanJob.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce(null);
    (
      prisma.repositorySnapshot.findUnique as jest.Mock<any>
    ).mockResolvedValueOnce({
      id: "snapshot-1",
      assessmentId: "assessment-1",
      commitSha: "a".repeat(40),
    });
    (prisma.assessment.findUnique as jest.Mock<any>).mockResolvedValueOnce({
      id: "assessment-1",
      ownerId: "user-1",
      status: ASSESSMENT_STATUS_CODES.wizardSubmitted,
    });
    (
      prisma.repositoryScanJob.findFirst as jest.Mock<any>
    ).mockResolvedValueOnce(null);
    (
      prisma.repositoryScanJob.findFirst as jest.Mock<any>
    ).mockResolvedValueOnce({ id: "old-job" });
    (prisma.repositoryScanJob.findMany as jest.Mock<any>)
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([{ id: "old-job" }]);
    (
      prisma.technicalEvidenceReport.findMany as jest.Mock<any>
    ).mockResolvedValueOnce([{ id: "report-1" }]);

    const result = await handler.execute(defaultCommand);

    expect(result.replaces_scan_job_id).toBe("old-job");
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.technicalEvidenceReport.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["report-1"] } },
    });
    // eslint-disable-next-line @typescript-eslint/unbound-method
    expect(prisma.repositoryScanJob.deleteMany).toHaveBeenCalledWith({
      where: { id: { in: ["old-job"] } },
    });
  });
});
