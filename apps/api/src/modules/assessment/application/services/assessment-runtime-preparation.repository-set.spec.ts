import { afterEach, describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import {
  REPOSITORY_SET_ERROR_CODES,
  computeRepositorySetDigest,
} from "@lcsp/contracts/assessment-domain";
import { AssessmentRuntimePreparation } from "./assessment-runtime-preparation.service.js";
import { REPOSITORY_LIMIT_ENV } from "./repository-set-limit.js";

const COMMIT = "132B5D796B32BF2F4454990B64DF7D0435E28161";
const COMMIT_B = "a".repeat(40);

type SnapshotRow = {
  id: string;
  commitSha: string;
  connectionId: string;
  repositoryId: string;
  repositoryFullName: string;
  sourcePathPrefix: string | null;
};

const web: SnapshotRow = {
  id: "snap-1",
  commitSha: COMMIT,
  connectionId: "conn-1",
  repositoryId: "repo-1",
  repositoryFullName: "Acme/Notice_Service",
  sourcePathPrefix: "apps/web",
};
const api: SnapshotRow = {
  id: "snap-2",
  commitSha: COMMIT_B,
  connectionId: "conn-2",
  repositoryId: "repo-2",
  repositoryFullName: "Acme/billing-api",
  sourcePathPrefix: null,
};

type Existing = Array<{ repositorySnapshotId: string }>;

function buildTx(existingPins: Existing, snapshots: SnapshotRow[] = [web]) {
  const created: Array<{ data: Array<Record<string, unknown>> }> = [];
  const caseUpdates: Array<Record<string, unknown>> = [];
  const tickets: string[] = [];
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
      findMany: jest.fn(async (args: { where: { id: { in: string[] } } }) =>
        snapshots.filter((row) => args.where.id.in.includes(row.id)),
      ),
    },
    repositoryScanJob: {
      upsert: jest.fn(async (args: { create: { snapshotId: string } }) => {
        tickets.push(args.create.snapshotId);
        return { id: `job-${args.create.snapshotId}` };
      }),
    },
    assessmentCaseRepository: {
      findMany: jest.fn(async () => existingPins),
      createMany: jest.fn(async (args: { data: Array<Record<string, unknown>> }) => {
        created.push(args);
        return { count: args.data.length };
      }),
    },
    // No rules: pinning stops with WAITING after the pins were written.
    assessmentRule: { findMany: jest.fn(async () => []) },
  } as unknown as Prisma.TransactionClient;
  return { tx, created, caseUpdates, tickets };
}

function service() {
  return new AssessmentRuntimePreparation({} as never, {} as never);
}

const input = (snapshotIds: string[]) => ({
  assessmentId: "a1",
  snapshotIds,
  correlationId: "corr-1",
});

describe("AssessmentRuntimePreparation repository set", () => {
  afterEach(() => {
    delete process.env[REPOSITORY_LIMIT_ENV];
  });

  it("records the ordinal-0 pin and stamps the case with the set digest", async () => {
    const { tx, created, caseUpdates } = buildTx([]);

    await service().pinRuntimeInputsInTx(tx, input(["snap-1"]));

    expect(created).toEqual([
      {
        data: [
          {
            assessmentId: "a1",
            repositoryKey: "notice-service",
            ordinal: 0,
            repositorySnapshotId: "snap-1",
            repositoryCommit: COMMIT.toLowerCase(),
            sourcePathPrefix: "apps/web",
            connectionId: "conn-1",
            repositoryId: "repo-1",
            repositoryFullName: "Acme/Notice_Service",
            repositoryScanJobId: "job-snap-1",
          },
        ],
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

  it("keeps the legacy scalar pin columns in step with the primary repository (dual write)", async () => {
    const { tx, caseUpdates } = buildTx([], [web, api]);

    await service().pinRuntimeInputsInTx(tx, input(["snap-1", "snap-2"]));

    expect(caseUpdates).toContainEqual({
      repositorySnapshotId: "snap-1",
      repositoryScanJobId: "job-snap-1",
      repositoryCommit: COMMIT.toLowerCase(),
    });
  });

  it("pins several repositories in the customer's order with unique keys, one hydration ticket each and one digest", async () => {
    const { tx, created, caseUpdates, tickets } = buildTx([], [web, api]);

    await service().pinRuntimeInputsInTx(tx, input(["snap-2", "snap-1"]));

    expect(tickets).toEqual(["snap-2", "snap-1"]);
    expect(
      created[0]?.data.map((pin) => [pin.repositoryKey, pin.ordinal]),
    ).toEqual([
      ["billing-api", 0],
      ["notice-service", 1],
    ]);
    expect(caseUpdates).toContainEqual(
      expect.objectContaining({
        repositoryCount: 2,
        repositorySetDigest: computeRepositorySetDigest([
          {
            repositoryKey: "billing-api",
            ordinal: 0,
            repositorySnapshotId: "snap-2",
            repositoryCommit: COMMIT_B,
            sourcePathPrefix: null,
          },
          {
            repositoryKey: "notice-service",
            ordinal: 1,
            repositorySnapshotId: "snap-1",
            repositoryCommit: COMMIT.toLowerCase(),
            sourcePathPrefix: "apps/web",
          },
        ]),
      }),
    );
  });

  it("allows the same repository twice with different source scopes and keys it uniquely", async () => {
    const second = { ...web, id: "snap-3", sourcePathPrefix: "apps/admin" };
    const { tx, created } = buildTx([], [web, second]);

    await service().pinRuntimeInputsInTx(tx, input(["snap-1", "snap-3"]));

    expect(created[0]?.data.map((pin) => pin.repositoryKey)).toEqual([
      "notice-service",
      "notice-service-2",
    ]);
  });

  it("rejects the same repository chosen twice with the same source scope", async () => {
    const twin = { ...web, id: "snap-3" };
    const { tx, created } = buildTx([], [web, twin]);

    await expect(
      service().pinRuntimeInputsInTx(tx, input(["snap-1", "snap-3"])),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        problem: { code: REPOSITORY_SET_ERROR_CODES.duplicate },
      },
    });
    expect(created).toHaveLength(0);
  });

  it("rejects the same snapshot chosen twice", async () => {
    const { tx } = buildTx([]);
    await expect(
      service().pinRuntimeInputsInTx(tx, input(["snap-1", "snap-1"])),
    ).rejects.toMatchObject({
      status: 422,
      response: { problem: { code: REPOSITORY_SET_ERROR_CODES.duplicate } },
    });
  });

  it("rejects a selection above the configured repository limit", async () => {
    process.env[REPOSITORY_LIMIT_ENV] = "1";
    const { tx, created } = buildTx([], [web, api]);

    await expect(
      service().pinRuntimeInputsInTx(tx, input(["snap-1", "snap-2"])),
    ).rejects.toMatchObject({
      status: 422,
      response: {
        problem: { code: REPOSITORY_SET_ERROR_CODES.limitExceeded },
      },
    });
    expect(created).toHaveLength(0);
  });

  it("never allows more than the contract maximum even when configuration asks for more", async () => {
    process.env[REPOSITORY_LIMIT_ENV] = "50";
    const ids = ["s1", "s2", "s3", "s4", "s5", "s6"];
    const { tx } = buildTx([], []);
    await expect(
      service().pinRuntimeInputsInTx(tx, input(ids)),
    ).rejects.toMatchObject({
      response: {
        problem: { code: REPOSITORY_SET_ERROR_CODES.limitExceeded },
      },
    });
  });

  it("rejects a selection that names a snapshot that is not ready or not on this assessment", async () => {
    const { tx, created } = buildTx([], [web]);

    await expect(
      service().pinRuntimeInputsInTx(tx, input(["snap-1", "snap-missing"])),
    ).rejects.toMatchObject({ status: 409 });
    expect(created).toHaveLength(0);
  });

  it("is a no-op for the identical ordered selection on retry", async () => {
    const { tx, created, caseUpdates } = buildTx(
      [{ repositorySnapshotId: "snap-1" }, { repositorySnapshotId: "snap-2" }],
      [web, api],
    );

    await service().pinRuntimeInputsInTx(tx, input(["snap-1", "snap-2"]));

    expect(created).toHaveLength(0);
    expect(caseUpdates.some((data) => "repositorySetDigest" in data)).toBe(
      false,
    );
  });

  it.each([
    ["a different repository", ["snap-2"]],
    ["an extra repository", ["snap-1", "snap-2"]],
    ["a set that merely includes it", ["snap-2", "snap-1"]],
  ])(
    "rejects %s because the repository set is immutable",
    async (_label, snapshotIds) => {
      const { tx, created } = buildTx(
        [{ repositorySnapshotId: "snap-1" }],
        [web, api],
      );

      await expect(
        service().pinRuntimeInputsInTx(tx, input(snapshotIds)),
      ).rejects.toMatchObject({
        status: 409,
        response: {
          problem: { code: REPOSITORY_SET_ERROR_CODES.immutable },
        },
      });
      expect(created).toHaveLength(0);
    },
  );
});
