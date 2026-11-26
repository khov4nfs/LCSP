import { jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import { computeRepositorySetDigest } from "@lcsp/contracts/assessment-domain";
import { AssessmentRuntimePreparation } from "./assessment-runtime-preparation.service.js";

const COMMIT = "132B5D796B32BF2F4454990B64DF7D0435E28161";

type Existing = Array<{ repositorySnapshotId: string }>;

function buildTx(existingPins: Existing) {
  const created: unknown[] = [];
  const caseUpdates: Array<Record<string, unknown>> = [];
  const tx = {
    assessmentCase: {
      findUnique: jest.fn(async () => ({
        assessmentId: "a1",
        ruleSetVersionId: "rs1",
        auditMode: "CUSTOMER_SELECTED",
      })),
      update: jest.fn(async (args: { data: Record<string, unknown> }) => {
        caseUpdates.push(args.data);
        return {};
      }),
    },
    repositorySnapshot: {
      findFirst: jest.fn(async () => ({
        id: "snap-1",
        commitSha: COMMIT,
        connectionId: "conn-1",
        repositoryId: "repo-1",
        repositoryFullName: "Acme/Notice_Service",
        sourcePathPrefix: "apps/web",
      })),
    },
    repositoryScanJob: { upsert: jest.fn(async () => ({ id: "job-1" })) },
    assessmentCaseRepository: {
      findMany: jest.fn(async () => existingPins),
      create: jest.fn(async (args: unknown) => {
        created.push(args);
        return {};
      }),
    },
    // No rules: pinning stops with WAITING after the pins were written.
    assessmentRule: { findMany: jest.fn(async () => []) },
  } as unknown as Prisma.TransactionClient;
  return { tx, created, caseUpdates };
}

function service() {
  return new AssessmentRuntimePreparation({} as never, {} as never);
}

const input = {
  assessmentId: "a1",
  snapshotId: "snap-1",
  correlationId: "corr-1",
};

describe("AssessmentRuntimePreparation repository set mirror", () => {
  it("records the ordinal-0 pin and stamps the case with the set digest", async () => {
    const { tx, created, caseUpdates } = buildTx([]);

    await service().pinRuntimeInputsInTx(tx, input);

    expect(created).toEqual([
      {
        data: {
          assessmentId: "a1",
          repositoryKey: "notice-service",
          ordinal: 0,
          repositorySnapshotId: "snap-1",
          repositoryCommit: COMMIT.toLowerCase(),
          sourcePathPrefix: "apps/web",
          connectionId: "conn-1",
          repositoryId: "repo-1",
          repositoryFullName: "Acme/Notice_Service",
          repositoryScanJobId: "job-1",
        },
      },
    ]);
    expect(caseUpdates).toContainEqual({
      repositorySetDigest: computeRepositorySetDigest([
        {
          repositoryKey: "notice-service",
          ordinal: 0,
          repositorySnapshotId: "snap-1",
          repositoryCommit: COMMIT.toLowerCase(),
          sourcePathPrefix: "apps/web",
        },
      ]),
      repositoryCount: 1,
    });
  });

  it("keeps the legacy scalar pin columns in step (dual write)", async () => {
    const { tx, caseUpdates } = buildTx([]);

    await service().pinRuntimeInputsInTx(tx, input);

    expect(caseUpdates).toContainEqual({
      repositorySnapshotId: "snap-1",
      repositoryScanJobId: "job-1",
      repositoryCommit: COMMIT.toLowerCase(),
    });
  });

  it("is a no-op for the same snapshot on retry", async () => {
    const { tx, created, caseUpdates } = buildTx([
      { repositorySnapshotId: "snap-1" },
    ]);

    await service().pinRuntimeInputsInTx(tx, input);

    expect(created).toHaveLength(0);
    expect(caseUpdates.some((data) => "repositorySetDigest" in data)).toBe(
      false,
    );
  });

  it("rejects a different snapshot because repository pins are immutable", async () => {
    const { tx, created } = buildTx([{ repositorySnapshotId: "snap-other" }]);

    await expect(
      service().pinRuntimeInputsInTx(tx, input),
    ).rejects.toMatchObject({ status: 409 });
    expect(created).toHaveLength(0);
  });
});
