import { HttpStatus } from "@nestjs/common";
import { describe, expect, it, jest } from "@jest/globals";
import {
  ASSESSMENT_GRAPH_STATES,
  ASSESSMENT_SETUP_CONFIRMATION_STATUSES,
  ASSESSMENT_STATUS_CODES,
  isAssessmentRepositorySetupState,
  type AssessmentStatusCode,
} from "@lcsp/contracts/assessment";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { Assessment } from "../../../domain/entities/assessment.entity.js";
import type { AssessmentRepository } from "../../ports/persistence/assessment.repository.js";
import { GetAssessmentReadinessHandler } from "./get-assessment-readiness.handler.js";
import { GetAssessmentReadinessQuery } from "./get-assessment-readiness.query.js";

function harness(
  options: {
    status?: AssessmentStatusCode;
    withoutConnection?: boolean;
    withoutSnapshot?: boolean;
    withJob?: boolean;
    manifestSnapshotIds?: string[];
  } = {},
) {
  const now = new Date("2026-10-01T00:00:00.000Z");
  const assessment = Assessment.rehydrate({
    id: "assessment-1",
    ownerId: "user-1",
    name: "Project",
    description: null,
    status: options.status ?? ASSESSMENT_STATUS_CODES.wizardInProgress,
    createdAt: now,
    updatedAt: now,
  });
  const connection = {
    id: "connection-1",
    provider: CREDENTIAL_PROVIDERS.github,
    repositoryId: "repository-1",
    repositoryFullName: "acme/project",
    defaultBranch: "main",
    status: REPOSITORY_CONNECTION_STATUSES.active,
  };
  const snapshot = {
    id: "snapshot-1",
    assessmentId: assessment.id,
    connectionId: connection.id,
    repositoryFullName: connection.repositoryFullName,
    branch: "main",
    commitSha: "a".repeat(40),
    createdAt: now,
  };
  const job = {
    id: "job-1",
    assessmentId: assessment.id,
    snapshotId: snapshot.id,
    status: REPOSITORY_SCAN_JOB_STATUSES.queued,
    attemptCount: 0,
    blockedReason: null,
    updatedAt: now,
  };
  const findAssessment = jest
    .fn<AssessmentRepository["findById"]>()
    .mockResolvedValue(assessment);
  const connectionQuery = jest
    .fn<(args: unknown) => Promise<typeof connection | null>>()
    .mockResolvedValue(options.withoutConnection ? null : connection);
  const snapshotQuery = jest
    .fn<(args: unknown) => Promise<typeof snapshot | null>>()
    .mockResolvedValue(options.withoutSnapshot ? null : snapshot);
  const jobQuery = jest
    .fn<(args: unknown) => Promise<typeof job | null>>()
    .mockResolvedValue(options.withJob ? job : null);
  const assessmentSetupQuery = jest
    .fn<() => Promise<Record<string, unknown> | null>>()
    .mockResolvedValue(
      options.manifestSnapshotIds
        ? {
            repositorySetupVersion: 1,
            repositorySetupManifest: {
              snapshots: options.manifestSnapshotIds.map((snapshotId) => ({
                snapshotId,
              })),
            },
            repositorySetupConfirmedAt: now,
          }
        : null,
    );
  const prisma = {
    assessment: { findUnique: assessmentSetupQuery },
    repositoryConnection: { findFirst: connectionQuery },
    technicalEvidenceReport: {
      findFirst: jest.fn<() => Promise<null>>().mockResolvedValue(null),
    },
    repositorySnapshot: { findFirst: snapshotQuery },
    repositoryScanJob: { findFirst: jobQuery },
  };
  const handler = new GetAssessmentReadinessHandler(
    { findById: findAssessment } as unknown as AssessmentRepository,
    prisma as unknown as PrismaService,
  );
  const query = new GetAssessmentReadinessQuery(
    assessment.id,
    assessment.ownerId,
    AUTH_USER_ROLES.customer,
    "correlation-1",
  );
  return {
    handler,
    query,
    assessment,
    connection,
    snapshot,
    job,
    connectionQuery,
    snapshotQuery,
    jobQuery,
  };
}

describe("GetAssessmentReadinessHandler repository setup checkpoint", () => {
  it("does not mark setup complete merely because a connection and snapshot exist", async () => {
    const test = harness();
    const result = await test.handler.execute(test.query);
    expect(result.completed_steps).toEqual([]);
    expect(result.repository_setup.assessmentStatus).toBe(
      ASSESSMENT_STATUS_CODES.wizardInProgress,
    );
    expect(result.repository_setup.snapshot?.id).toBe(test.snapshot.id);
    expect(result.repository_setup.scanJob).toBeNull();
    expect(isAssessmentRepositorySetupState(result.repository_setup)).toBe(
      true,
    );
  });

  it("returns a submitted setup and its persisted scan, scoped to the active connection", async () => {
    const test = harness({
      status: ASSESSMENT_STATUS_CODES.wizardSubmitted,
      withJob: true,
    });
    const result = await test.handler.execute(test.query);
    expect(result.completed_steps).toEqual(["repository_setup"]);
    expect(result.repository_setup.scanJob?.id).toBe(test.job.id);
    expect(isAssessmentRepositorySetupState(result.repository_setup)).toBe(
      true,
    );
    expect(test.snapshotQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assessmentId: test.assessment.id,
          connectionId: test.connection.id,
          status: REPOSITORY_SNAPSHOT_STATUSES.ready,
        },
      }),
    );
    expect(test.jobQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          assessmentId: test.assessment.id,
          snapshotId: test.snapshot.id,
        },
      }),
    );
  });

  it("does not confirm setup when the persisted manifest omits a current snapshot", async () => {
    const test = harness({
      status: ASSESSMENT_STATUS_CODES.wizardSubmitted,
      withJob: true,
      manifestSnapshotIds: ["older-snapshot"],
    });

    const result = await test.handler.execute(test.query);

    expect(result.completed_steps).toEqual([]);
    expect(result.repository_setup.confirmed).toBe(false);
    expect(result.repository_setup.confirmation?.status).toBe(
      ASSESSMENT_SETUP_CONFIRMATION_STATUSES.draft,
    );
    expect(result.repository_setup.programEvidenceGraph?.state).toBe(
      ASSESSMENT_GRAPH_STATES.notReady,
    );
  });

  it("preserves an incomplete connection checkpoint without inventing a snapshot or job", async () => {
    const test = harness({ withoutSnapshot: true });
    const result = await test.handler.execute(test.query);
    expect(result.completed_steps).toEqual([]);
    expect(result.repository_setup.snapshot).toBeNull();
    expect(result.repository_setup.scanJob).toBeNull();
    expect(test.jobQuery).not.toHaveBeenCalled();
    expect(isAssessmentRepositorySetupState(result.repository_setup)).toBe(
      true,
    );
  });

  it("does not attach historical snapshots when there is no active connection", async () => {
    const test = harness({ withoutConnection: true });
    const result = await test.handler.execute(test.query);
    expect(result.repository_setup.connection).toBeNull();
    expect(result.repository_setup.snapshot).toBeNull();
    expect(test.snapshotQuery).not.toHaveBeenCalled();
    expect(test.jobQuery).not.toHaveBeenCalled();
  });

  it("does not read repository checkpoints belonging to another Customer", async () => {
    const test = harness();
    const query = new GetAssessmentReadinessQuery(
      test.assessment.id,
      "another-user",
      AUTH_USER_ROLES.customer,
      "correlation-1",
    );
    await expect(test.handler.execute(query)).rejects.toMatchObject({
      status: HttpStatus.NOT_FOUND,
    });
    expect(test.connectionQuery).not.toHaveBeenCalled();
    expect(test.snapshotQuery).not.toHaveBeenCalled();
    expect(test.jobQuery).not.toHaveBeenCalled();
  });
});
