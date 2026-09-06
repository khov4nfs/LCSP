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
import { Assessment } from "../../../domain/entities/assessment.entity.js";
import type { AssessmentRepository } from "../../ports/persistence/assessment.repository.js";
import { CompleteRepositorySetupCommand } from "./complete-repository-setup.command.js";
import { CompleteRepositorySetupHandler } from "./complete-repository-setup.handler.js";

const commitSha = "a".repeat(40);

function buildHandler(input?: {
  assessmentStatus?: string;
  hasConnection?: boolean;
  hasSnapshot?: boolean;
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
  const tx = { id: "repository-setup-tx" };
  const transaction = jest.fn((callback: (client: unknown) => unknown) =>
    Promise.resolve(callback(tx)),
  );
  const connectionFindFirst = jest
    .fn<(args: unknown) => Promise<{ id: string } | null>>()
    .mockResolvedValue(
      input?.hasConnection === false ? null : { id: "connection-1" },
    );
  const snapshotFindFirst = jest
    .fn<(args: unknown) => Promise<{ id: string; commitSha: string } | null>>()
    .mockResolvedValue(
      input?.hasSnapshot === false ? null : { id: "snapshot-1", commitSha },
    );
  const prisma = {
    repositoryConnection: { findFirst: connectionFindFirst },
    repositorySnapshot: { findFirst: snapshotFindFirst },
    $transaction: transaction,
  };
  const handler = new CompleteRepositorySetupHandler(
    repository,
    prisma as never,
    { writeInTx } as unknown as AuditWriterService,
  );

  return {
    assessment,
    connectionFindFirst,
    handler,
    saveInTx,
    snapshotFindFirst,
    transaction,
    tx,
    writeInTx,
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
    expect(context.connectionFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          status: REPOSITORY_CONNECTION_STATUSES.active,
        }),
      }),
    );
    expect(context.snapshotFindFirst).toHaveBeenCalledWith(
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
