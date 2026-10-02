import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_ERROR_CODES,
  ASSESSMENT_EVENT_TYPES,
  ASSESSMENT_STATUS_CODES,
} from "@lcsp/contracts/assessment";
import {
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";
import { ConflictException } from "@nestjs/common";

import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { Assessment } from "../../../domain/entities/assessment.entity.js";
import type { AssessmentRepository } from "../../ports/persistence/assessment.repository.js";
import { CompleteRepositorySetupCommand } from "./complete-repository-setup.command.js";
import { CompleteRepositorySetupHandler } from "./complete-repository-setup.handler.js";

const commitSha = "a".repeat(40);

function buildHandler(input?: {
  assessmentStatus?: string;
  hasConnection?: boolean;
  hasSnapshot?: boolean;
  connectionCount?: number;
  withScanJobs?: boolean;
}) {
  const assessment = Assessment.rehydrate({
    id: "assessment-1",
    ownerId: "user-1",
    name: "Repository-first assessment",
    description: null,
    status:
      input?.assessmentStatus === ASSESSMENT_STATUS_CODES.wizardSubmitted
        ? ASSESSMENT_STATUS_CODES.wizardSubmitted
        : ASSESSMENT_STATUS_CODES.wizardInProgress,
    createdAt: new Date("2026-09-05T00:00:00.000Z"),
    updatedAt: new Date("2026-09-05T00:00:00.000Z"),
  });
  const saveInTx = jest
    .fn<AssessmentRepository["saveInTx"]>()
    .mockResolvedValue(undefined);
  const repository: AssessmentRepository = {
    save: jest.fn<AssessmentRepository["save"]>().mockResolvedValue(undefined),
    saveInTx,
    findById: jest
      .fn<AssessmentRepository["findById"]>()
      .mockResolvedValue(assessment),
    findMany: jest
      .fn<AssessmentRepository["findMany"]>()
      .mockResolvedValue({ items: [], total: 0 }),
  };
  const writeInTx = jest
    .fn<AuditWriterService["writeInTx"]>()
    .mockResolvedValue(undefined);
  const tx = { id: "repository-setup-tx" } as Record<string, unknown>;
  const scanJobCreate = jest
    .fn<(input: { data: Record<string, unknown> }) => Promise<unknown>>()
    .mockResolvedValue({});
  const scanJobFindUnique = jest
    .fn<(input: unknown) => Promise<null>>()
    .mockResolvedValue(null);
  const relationFindMany = jest
    .fn<(input: unknown) => Promise<unknown[]>>()
    .mockResolvedValue([]);
  const outboxEnqueue = jest
    .fn<(input: unknown, tx: unknown) => Promise<string>>()
    .mockResolvedValue("outbox-1");
  if (input?.withScanJobs) {
    tx.repositoryScanJob = {
      create: scanJobCreate,
      findUnique: scanJobFindUnique,
    };
    tx.assessmentRepositoryRelation = { findMany: relationFindMany };
  }
  const transaction = jest.fn((callback: (client: unknown) => unknown) =>
    Promise.resolve(callback(tx)),
  );
  const connectionFindMany = jest
    .fn<(args: unknown) => Promise<Array<{ id: string }>>>()
    .mockResolvedValue(
      input?.hasConnection === false
        ? []
        : Array.from({ length: input?.connectionCount ?? 1 }, (_, index) => ({
            id: `connection-${index + 1}`,
          })),
    );
  const snapshotFindMany = jest
    .fn<
      (
        args: unknown,
      ) => Promise<
        Array<{ id: string; connectionId: string; commitSha: string }>
      >
    >()
    .mockResolvedValue(
      input?.hasSnapshot === false
        ? []
        : Array.from({ length: input?.connectionCount ?? 1 }, (_, index) => ({
            id: `snapshot-${index + 1}`,
            connectionId: `connection-${index + 1}`,
            commitSha,
          })),
    );
  const prisma = {
    repositoryConnection: { findMany: connectionFindMany },
    repositorySnapshot: { findMany: snapshotFindMany },
    $transaction: transaction,
  };
  const handler = new CompleteRepositorySetupHandler(
    repository,
    prisma as never,
    { writeInTx } as unknown as AuditWriterService,
    input?.withScanJobs
      ? ({ enqueue: outboxEnqueue } as unknown as OutboxRepository)
      : undefined,
  );

  return {
    assessment,
    connectionFindMany,
    handler,
    saveInTx,
    snapshotFindMany,
    transaction,
    tx,
    writeInTx,
    scanJobCreate,
    scanJobFindUnique,
    relationFindMany,
    outboxEnqueue,
  };
}

describe("CompleteRepositorySetupHandler", () => {
  it("submits the assessment only after an active connection and ready snapshot", async () => {
    const context = buildHandler();

    const result = await context.handler.execute(
      new CompleteRepositorySetupCommand(
        "assessment-1",
        "user-1",
        "correlation-1",
      ),
    );

    expect(result).toMatchObject({
      assessment_id: "assessment-1",
      status: ASSESSMENT_STATUS_CODES.wizardSubmitted,
      repository_connection_id: "connection-1",
      snapshot_id: "snapshot-1",
      commit_sha: commitSha,
    });
    expect(context.connectionFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: REPOSITORY_CONNECTION_STATUSES.active,
        }),
      }),
    );
    expect(context.snapshotFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: REPOSITORY_SNAPSHOT_STATUSES.ready,
        }),
      }),
    );
    expect(context.saveInTx.mock.calls[0][1]).toBe(context.tx);
    expect(context.writeInTx.mock.calls[0][0]).toMatchObject({
      eventType: ASSESSMENT_EVENT_TYPES.repositorySetupCompleted,
    });
  });

  it("rejects transition when the pinned snapshot is missing", async () => {
    const context = buildHandler({ hasSnapshot: false });

    await expect(
      context.handler.execute(
        new CompleteRepositorySetupCommand(
          "assessment-1",
          "user-1",
          "correlation-1",
        ),
      ),
    ).rejects.toThrow(ConflictException);

    try {
      await context.handler.execute(
        new CompleteRepositorySetupCommand(
          "assessment-1",
          "user-1",
          "correlation-1",
        ),
      );
    } catch (error) {
      expect((error as ConflictException).getResponse()).toMatchObject({
        problem: {
          code: ASSESSMENT_ERROR_CODES.repositorySetupIncomplete,
        },
      });
    }
    expect(context.transaction).not.toHaveBeenCalled();
  });

  it("requires every connected repository to have a pinned snapshot before confirmation", async () => {
    const context = buildHandler({ connectionCount: 2 });
    await context.handler.execute(
      new CompleteRepositorySetupCommand(
        "assessment-1",
        "user-1",
        "correlation-1",
      ),
    );
    expect(context.writeInTx.mock.calls[0][0]).toMatchObject({
      payload: {
        repositories: [
          { connectionId: "connection-1", snapshotId: "snapshot-1", commitSha },
          { connectionId: "connection-2", snapshotId: "snapshot-2", commitSha },
        ],
      },
    });
  });

  it("creates one idempotent scan job and outbox event per pinned snapshot", async () => {
    const context = buildHandler({ connectionCount: 2, withScanJobs: true });

    await context.handler.execute(
      new CompleteRepositorySetupCommand(
        "assessment-1",
        "user-1",
        "correlation-1",
      ),
    );

    expect(context.scanJobCreate).toHaveBeenCalledTimes(2);
    expect(context.outboxEnqueue).toHaveBeenCalledTimes(2);
    const createdSnapshots = context.scanJobCreate.mock.calls.map(
      ([input]) => (input as { data: { snapshotId: string } }).data.snapshotId,
    );
    expect(createdSnapshots).toEqual(
      expect.arrayContaining(["snapshot-1", "snapshot-2"]),
    );
  });

  it("returns the existing pinned state without writing a second audit event", async () => {
    const context = buildHandler({
      assessmentStatus: ASSESSMENT_STATUS_CODES.wizardSubmitted,
    });

    const result = await context.handler.execute(
      new CompleteRepositorySetupCommand(
        "assessment-1",
        "user-1",
        "correlation-1",
      ),
    );

    expect(result.status).toBe(ASSESSMENT_STATUS_CODES.wizardSubmitted);
    expect(context.transaction).not.toHaveBeenCalled();
    expect(context.writeInTx).not.toHaveBeenCalled();
  });
});
