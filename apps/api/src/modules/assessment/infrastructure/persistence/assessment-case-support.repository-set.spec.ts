import { describe, expect, it } from "@jest/globals";
import type { Prisma } from "@prisma/client";
import {
  ASSESSMENT_DOMAIN_ERROR_CODES,
  computeRepositorySetDigest,
} from "@lcsp/contracts/assessment-domain";

import { evidenceBelongsToPinnedSet } from "../../domain/decision-validator.js";
import { AssessmentCaseSupport } from "./assessment-case-support.service.js";

const assessmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const COMMIT_A = "a".repeat(40);
const COMMIT_B = "b".repeat(40);

const caseRow = {
  assessmentId,
  caseRevision: 2,
  ruleSetVersionId: "rule-set-1",
  repositorySnapshotId: "snap-a",
  repositoryScanJobId: "job-a",
  repositoryCommit: COMMIT_A,
  repositorySetDigest: null as string | null,
  repositoryCount: 0,
};

const primarySnapshot = {
  id: "snap-a",
  repositoryId: "repo-a",
  assessmentId,
  commitSha: COMMIT_A,
  sourcePathPrefix: "apps/web",
  connectionId: "conn-a",
  repositoryFullName: "acme/web",
};

function pinRow(overrides: Record<string, unknown> = {}) {
  return {
    assessmentId,
    repositoryKey: "web",
    ordinal: 0,
    connectionId: "conn-a",
    repositoryId: "repo-a",
    repositoryFullName: "acme/web",
    repositorySnapshotId: "snap-a",
    repositoryScanJobId: "job-a",
    repositoryCommit: COMMIT_A,
    sourcePathPrefix: "apps/web",
    ...overrides,
  };
}

const secondRow = () =>
  pinRow({
    repositoryKey: "api",
    ordinal: 1,
    connectionId: "conn-b",
    repositoryId: "repo-b",
    repositoryFullName: "acme/api",
    repositorySnapshotId: "snap-b",
    repositoryScanJobId: "job-b",
    repositoryCommit: COMMIT_B,
    sourcePathPrefix: null,
  });

const secondSnapshot = {
  id: "snap-b",
  commitSha: COMMIT_B,
  sourcePathPrefix: null as string | null,
};

function tx(options: {
  caseOverrides?: Partial<typeof caseRow>;
  pins: unknown[];
  extraSnapshots?: unknown[];
}) {
  return {
    assessmentCase: {
      findUnique: () =>
        Promise.resolve({ ...caseRow, ...options.caseOverrides }),
    },
    repositorySnapshot: {
      findFirst: () => Promise.resolve(primarySnapshot),
      findMany: () => Promise.resolve(options.extraSnapshots ?? []),
    },
    assessmentCaseRepository: { findMany: () => Promise.resolve(options.pins) },
  } as unknown as Prisma.TransactionClient;
}

const load = (client: Prisma.TransactionClient) =>
  new AssessmentCaseSupport().loadPins(client, assessmentId, "corr-set");

const pinsNotReady = {
  response: {
    problem: { code: ASSESSMENT_DOMAIN_ERROR_CODES.PINS_NOT_READY, status: 409 },
  },
};

describe("AssessmentCaseSupport repository set", () => {
  it("derives a set of one from the scalar pin when no rows are recorded", async () => {
    const pins = await load(tx({ pins: [] }));

    expect(pins.repositories).toHaveLength(1);
    expect(pins.repositories[0]).toMatchObject({
      repositoryKey: "web",
      ordinal: 0,
      repositorySnapshotId: "snap-a",
      repositoryScanJobId: "job-a",
    });
    expect(pins.repositorySetDigest).toBe(
      computeRepositorySetDigest(pins.repositories),
    );
  });

  it("returns every recorded pin in ordinal order with a matching digest", async () => {
    const rows = [pinRow(), secondRow()];
    const digest = computeRepositorySetDigest(
      rows as Parameters<typeof computeRepositorySetDigest>[0],
    );

    const pins = await load(
      tx({
        pins: rows,
        extraSnapshots: [secondSnapshot],
        caseOverrides: { repositorySetDigest: digest, repositoryCount: 2 },
      }),
    );

    expect(pins.repositories.map((pin) => pin.repositoryKey)).toEqual([
      "web",
      "api",
    ]);
    expect(pins.repositorySetDigest).toBe(digest);
    // Scalar fields still describe the primary repository for unconverted readers.
    expect(pins).toMatchObject({
      repositorySnapshotId: "snap-a",
      repositoryCommit: COMMIT_A,
    });
  });

  it.each([
    [
      "a stored digest that does not match the recorded rows",
      () =>
        tx({
          pins: [pinRow(), secondRow()],
          extraSnapshots: [secondSnapshot],
          caseOverrides: {
            repositorySetDigest: `sha256:${"0".repeat(64)}`,
            repositoryCount: 2,
          },
        }),
    ],
    [
      "a stored count that disagrees with the rows",
      () =>
        tx({
          pins: [pinRow(), secondRow()],
          extraSnapshots: [secondSnapshot],
          caseOverrides: { repositoryCount: 1 },
        }),
    ],
    [
      "a primary pin that is not the case scalar pin",
      () => tx({ pins: [pinRow({ repositorySnapshotId: "snap-other" })] }),
    ],
    [
      "non-contiguous ordinals",
      () => tx({ pins: [pinRow(), { ...secondRow(), ordinal: 2 }] }),
    ],
    [
      "an additional pin whose snapshot is not owned by the assessment",
      () => tx({ pins: [pinRow(), secondRow()], extraSnapshots: [] }),
    ],
    [
      "an additional pin whose snapshot commit differs",
      () =>
        tx({
          pins: [pinRow(), secondRow()],
          extraSnapshots: [{ ...secondSnapshot, commitSha: "c".repeat(40) }],
        }),
    ],
    [
      "an additional pin with a non-canonical source scope",
      () =>
        tx({
          pins: [pinRow(), secondRow()],
          extraSnapshots: [{ ...secondSnapshot, sourcePathPrefix: "a/../b" }],
        }),
    ],
  ])("fails closed for %s", async (_name, build) => {
    await expect(load(build())).rejects.toMatchObject(pinsNotReady);
  });
});

describe("evidenceBelongsToPinnedSet", () => {
  const pins = {
    ruleSetVersionId: "rule-set-1",
    repositorySnapshotId: "snap-a",
    repositoryCommit: COMMIT_A,
    repositories: [
      { repositoryKey: "web", repositoryCommit: COMMIT_A },
      { repositoryKey: "api", repositoryCommit: COMMIT_B },
    ],
  };

  it("accepts evidence from any pinned repository", () => {
    expect(
      evidenceBelongsToPinnedSet(
        { repositoryCommit: COMMIT_B, repositoryKey: "api" },
        pins,
      ),
    ).toBe(true);
  });

  it("rejects a commit pinned for a different repository key", () => {
    expect(
      evidenceBelongsToPinnedSet(
        { repositoryCommit: COMMIT_B, repositoryKey: "web" },
        pins,
      ),
    ).toBe(false);
  });

  it("matches keyless evidence by commit and rejects commits outside the set", () => {
    expect(evidenceBelongsToPinnedSet({ repositoryCommit: COMMIT_B }, pins)).toBe(
      true,
    );
    expect(
      evidenceBelongsToPinnedSet({ repositoryCommit: "c".repeat(40) }, pins),
    ).toBe(false);
  });

  it("treats a context without a recorded set as its single scalar pin", () => {
    const legacy = {
      ruleSetVersionId: "rule-set-1",
      repositorySnapshotId: "snap-a",
      repositoryCommit: COMMIT_A,
    };
    expect(
      evidenceBelongsToPinnedSet({ repositoryCommit: COMMIT_A }, legacy),
    ).toBe(true);
    expect(
      evidenceBelongsToPinnedSet({ repositoryCommit: COMMIT_B }, legacy),
    ).toBe(false);
  });
});
