import { describe, expect, it, jest, beforeEach } from "@jest/globals";
import { Test, type TestingModule } from "@nestjs/testing";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import { REPOSITORY_SCAN_JOB_STATUSES } from "@lcsp/contracts/github-integration";
import { PBAC_ACTIONS, SUBJECT_ROLES } from "@lcsp/contracts/pbac";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { RerunScanHandler } from "./rerun-scan.handler.js";
import { RerunScanCommand } from "./rerun-scan.command.js";

describe("RerunScanHandler", () => {
  let handler: RerunScanHandler;
  let prisma: jest.Mocked<PrismaService>;
  let auditWriter: jest.Mocked<AuditWriterService>;
  let outbox: jest.Mocked<OutboxRepository>;

  const defaultPbac = {
    userId: "user-1",
    sessionId: "sess",
    organizationId: "org-1",
    subjectRole: SUBJECT_ROLES.manager,
    scope: "assessment-1",
    grantedActions: [],
    selectedAction: PBAC_ACTIONS.scanTrigger,
    policyId: "pol",
    policyVersion: "1",
  };

  const defaultCommand = new RerunScanCommand(
    "assessment-1",
    "snapshot-1",
    "idempotency-key",
    defaultPbac,
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
            repositoryScanJob: {
              findUnique: jest.fn(),
              findFirst: jest.fn(),
              create: jest.fn(),
            },
            repositorySnapshot: {
              findUnique: jest.fn(),
            },
            assessment: {
              findUnique: jest.fn(),
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
  });

  it("throws BadRequestException if idempotencyKey is missing", async () => {
    const cmd = new RerunScanCommand(
      "assessment-1",
      "snapshot-1",
      "",
      defaultPbac,
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
      organizationId: "org-1",
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
      organizationId: "org-1",
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
      organizationId: "org-1",
      commitSha: "a".repeat(40),
    });
    (prisma.assessment.findUnique as jest.Mock<any>).mockResolvedValueOnce({
      id: "assessment-1",
      organizationId: "org-1",
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
      organizationId: "org-1",
      commitSha: "a".repeat(40),
    });
    (prisma.assessment.findUnique as jest.Mock<any>).mockResolvedValueOnce({
      id: "assessment-1",
      organizationId: "org-1",
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
      organizationId: "org-1",
      commitSha: "a".repeat(40),
    });
    (prisma.assessment.findUnique as jest.Mock<any>).mockResolvedValueOnce({
      id: "assessment-1",
      organizationId: "org-1",
      ownerId: "user-1",
      status: ASSESSMENT_STATUS_CODES.wizardSubmitted,
    });

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
});
