import { describe, expect, it, jest } from "@jest/globals";
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import { ASSESSMENT_STATUS_CODES } from "@lcsp/contracts/assessment";
import {
  GITHUB_INTEGRATION_EVENT_TYPES,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SCAN_TRIGGER_SOURCES,
} from "@lcsp/contracts/github-integration";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { RepositoryScanJob } from "../../../domain/entities/repository-scan-job.entity.js";
import type { RepositoryScanJobRepository } from "../../ports/persistence/repository-scan-job.repository.js";
import { TriggerScanCommand } from "./trigger-scan.command.js";
import { TriggerScanHandler } from "./trigger-scan.handler.js";

const SNAPSHOT = {
  id: "snapshot-1",
  assessmentId: "assessment-1",
  repositoryId: "repo-1",
  repositoryFullName: "acme/example-repo",
  commitSha: "a".repeat(40),
};

function command(overrides?: Partial<TriggerScanCommand>): TriggerScanCommand {
  return new TriggerScanCommand(
    overrides?.assessmentId ?? "assessment-1",
    overrides?.snapshotId ?? "snapshot-1",
    overrides?.triggerSource ?? REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
    overrides?.idempotencyKey ?? "scan-request:assessment-1:snapshot-1:1",
    overrides?.actorId === undefined ? "manager-1" : overrides.actorId,
    overrides?.subjectRole === undefined
      ? AUTH_USER_ROLES.customer
      : overrides.subjectRole,
    overrides?.scope,
    overrides?.correlationId ?? "corr-1",
  );
}

function buildHandler(options?: {
  snapshot?: typeof SNAPSHOT | null;
  assessment?: {
    id: string;
    ownerId: string;
    status: string;
  } | null;
  existing?: RepositoryScanJob | null;
}) {
  const findByIdempotencyKey = jest
    .fn<RepositoryScanJobRepository["findByIdempotencyKey"]>()
    .mockResolvedValue(options?.existing ?? null);
  const saveWithTriggeredEvent = jest
    .fn<RepositoryScanJobRepository["saveWithTriggeredEvent"]>()
    .mockResolvedValue(undefined);
  const save = jest
    .fn<RepositoryScanJobRepository["save"]>()
    .mockResolvedValue(undefined);
  const repository = {
    findByIdempotencyKey,
    save,
    saveWithTriggeredEvent,
  } as RepositoryScanJobRepository;

  const snapshotFindUnique = jest.fn<() => Promise<typeof SNAPSHOT | null>>();
  snapshotFindUnique.mockResolvedValue(
    options?.snapshot === undefined ? SNAPSHOT : options.snapshot,
  );
  const assessmentFindUnique = jest.fn<
    () => Promise<{
      id: string;
      ownerId: string;
      status: string;
    } | null>
  >();
  assessmentFindUnique.mockResolvedValue(
    options?.assessment === undefined
      ? {
          id: "assessment-1",
          ownerId: "manager-1",
          status: ASSESSMENT_STATUS_CODES.wizardSubmitted,
        }
      : options.assessment,
  );
  const prisma = {
    repositorySnapshot: { findUnique: snapshotFindUnique },
    assessment: { findUnique: assessmentFindUnique },
  } as unknown as PrismaService;

  const write = jest
    .fn<AuditWriterService["write"]>()
    .mockResolvedValue(undefined);
  const handler = new TriggerScanHandler(repository, prisma, {
    write,
  } as unknown as AuditWriterService);

  return {
    handler,
    findByIdempotencyKey,
    save,
    saveWithTriggeredEvent,
    write,
  };
}

describe("TriggerScanHandler", () => {
  it("creates a queued job and durable scan.triggered outbox command", async () => {
    const { handler, saveWithTriggeredEvent, write } = buildHandler();

    const result = await handler.execute(command());

    expect(result).toMatchObject({
      status: REPOSITORY_SCAN_JOB_STATUSES.queued,
      is_new: true,
      correlationId: "corr-1",
    });
    const [job, event] = saveWithTriggeredEvent.mock.calls[0];
    expect(job.snapshotId).toBe("snapshot-1");
    expect(job.attemptCount).toBe(0);
    expect(event).toMatchObject({
      eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanTriggered,
      payload: {
        scanJobId: job.id,
        assessmentId: "assessment-1",
        snapshotId: "snapshot-1",
        commitSha: SNAPSHOT.commitSha,
        triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
        idempotencyKey: "scan-request:assessment-1:snapshot-1:1",
        correlationId: "corr-1",
      },
    });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: GITHUB_INTEGRATION_EVENT_TYPES.scanJobTriggeredAudit,
      }),
    );
  });

  it("returns the existing state without creating another outbox command", async () => {
    const existing = RepositoryScanJob.rehydrate({
      id: "scan-job-existing",
      assessmentId: "assessment-1",
      snapshotId: "snapshot-1",
      idempotencyKey: "scan-request:assessment-1:snapshot-1:1",
      triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
      status: REPOSITORY_SCAN_JOB_STATUSES.running,
      attemptCount: 1,
      correlationId: "original-corr",
      blockedReason: null,
      createdAt: new Date("2026-07-18T00:00:00.000Z"),
      updatedAt: new Date("2026-07-18T00:01:00.000Z"),
    });
    const { handler, saveWithTriggeredEvent } = buildHandler({
      existing,
      assessment: {
        id: "assessment-1",
        ownerId: "manager-1",
        status: ASSESSMENT_STATUS_CODES.scanInProgress,
      },
    });

    const result = await handler.execute(command());

    expect(result).toEqual({
      scan_job_id: "scan-job-existing",
      status: REPOSITORY_SCAN_JOB_STATUSES.running,
      is_new: false,
      correlationId: "corr-1",
    });
    expect(saveWithTriggeredEvent).not.toHaveBeenCalled();
  });

  it("rejects reuse of an idempotency key with different material input", async () => {
    const existing = RepositoryScanJob.rehydrate({
      id: "scan-job-existing",
      assessmentId: "assessment-other",
      snapshotId: "snapshot-other",
      idempotencyKey: "scan-request:assessment-1:snapshot-1:1",
      triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.manual,
      status: REPOSITORY_SCAN_JOB_STATUSES.queued,
      attemptCount: 0,
      correlationId: "original-corr",
      blockedReason: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const { handler } = buildHandler({ existing });

    await expect(handler.execute(command())).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it("hides a missing or wrong-assessment snapshot", async () => {
    for (const snapshot of [
      null,
      { ...SNAPSHOT, assessmentId: "assessment-other" },
    ]) {
      const { handler, saveWithTriggeredEvent } = buildHandler({ snapshot });

      await expect(handler.execute(command())).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(saveWithTriggeredEvent).not.toHaveBeenCalled();
    }
  });

  it("blocks an assessment state that cannot start a scan", async () => {
    const { handler, saveWithTriggeredEvent } = buildHandler({
      assessment: {
        id: "assessment-1",
        ownerId: "manager-1",
        status: ASSESSMENT_STATUS_CODES.wizardInProgress,
      },
    });

    await expect(handler.execute(command())).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(saveWithTriggeredEvent).not.toHaveBeenCalled();
  });

  it("persists a controlled pending-mapping job before enqueue", async () => {
    const { handler, save, saveWithTriggeredEvent } = buildHandler({
      snapshot: { ...SNAPSHOT, repositoryId: "" },
    });

    const result = await handler.execute(command());

    expect(result).toMatchObject({
      status: REPOSITORY_SCAN_JOB_STATUSES.pendingMapping,
      is_new: true,
      correlationId: "corr-1",
    });
    const [job] = save.mock.calls[0] ?? [];
    expect(job.status).toBe(REPOSITORY_SCAN_JOB_STATUSES.pendingMapping);
    expect(job.blockedReason).toBe("SCAN_BLOCKED_MAPPING");
    expect(saveWithTriggeredEvent).not.toHaveBeenCalled();
  });

  it.each([
    [
      "wait-safe missing commit context",
      "",
      REPOSITORY_SCAN_JOB_STATUSES.waitingForContext,
    ],
    [
      "unsafe commit mapping",
      "not-a-commit",
      REPOSITORY_SCAN_JOB_STATUSES.blockedMapping,
    ],
  ])(
    "persists %s without enqueueing a scan",
    async (_caseName, commitSha, expectedStatus) => {
      const { handler, save, saveWithTriggeredEvent } = buildHandler({
        snapshot: { ...SNAPSHOT, commitSha },
      });

      const result = await handler.execute(command());

      expect(result.status).toBe(expectedStatus);
      expect(save.mock.calls[0]?.[0].status).toBe(expectedStatus);
      expect(saveWithTriggeredEvent).not.toHaveBeenCalled();
    },
  );

  it("allows a trusted worker and rejects a manual actor outside ownership", async () => {
    const trusted = buildHandler();
    await expect(
      trusted.handler.execute(
        command({
          triggerSource: REPOSITORY_SCAN_TRIGGER_SOURCES.trusted,
          actorId: null,
          subjectRole: null,
        }),
      ),
    ).resolves.toMatchObject({ is_new: true });

    const manual = buildHandler();
    await expect(
      manual.handler.execute(command({ actorId: "manager-other" })),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
