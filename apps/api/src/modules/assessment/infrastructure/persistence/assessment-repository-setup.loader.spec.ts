import { afterEach, describe, expect, it } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  AGENT_EXECUTION_STATES,
  ASSESSMENT_LIFECYCLE_STATES,
} from "@lcsp/contracts/assessment";
import {
  CREDENTIAL_PROVIDERS,
  REPOSITORY_CONNECTION_STATUSES,
  REPOSITORY_SCAN_JOB_STATUSES,
  REPOSITORY_SNAPSHOT_STATUSES,
} from "@lcsp/contracts/github-integration";
import { createHash, randomUUID } from "node:crypto";
import { REPOSITORY_LIMIT_ENV } from "../../application/services/repository-set-limit.js";
import { AssessmentRepositorySetupLoader } from "./assessment-repository-setup.loader.js";

const ownerId = randomUUID();
const assessmentId = randomUUID();

interface SnapshotFixture {
  id: string;
  connectionId: string;
  repositoryFullName: string;
  sourcePathPrefix: string | null;
  commitSha: string;
  createdAt: string;
}

function snapshot(
  id: string,
  connectionId: string,
  overrides: Partial<SnapshotFixture> = {},
) {
  return {
    id,
    assessmentId,
    connectionId,
    repositoryFullName: `owner/${connectionId}`,
    branch: "main",
    commitSha: createHash("sha1").update(id).digest("hex"),
    sourcePathPrefix: null,
    status: REPOSITORY_SNAPSHOT_STATUSES.ready,
    createdAt: new Date("2026-11-04T00:00:00.000Z"),
    ...overrides,
    ...(overrides.createdAt ? { createdAt: new Date(overrides.createdAt) } : {}),
  };
}

function connection(id: string, at = "2026-11-01T00:00:00.000Z") {
  return {
    id,
    provider: CREDENTIAL_PROVIDERS.github,
    repositoryId: `rid-${id}`,
    repositoryFullName: `owner/${id}`,
    defaultBranch: "main",
    status: REPOSITORY_CONNECTION_STATUSES.active,
    connectedAt: new Date(at),
  };
}

function scanJob(id: string, snapshotId: string) {
  return {
    id,
    assessmentId,
    snapshotId,
    status: REPOSITORY_SCAN_JOB_STATUSES.queued,
    attemptCount: 0,
    blockedReason: null,
    updatedAt: new Date("2026-11-04T00:00:00.000Z"),
    createdAt: new Date("2026-11-04T00:00:00.000Z"),
  };
}

function loaderFor(options: {
  pins?: Array<{
    repositoryKey: string;
    repositorySnapshotId: string;
    repositoryScanJobId: string;
  }>;
  domainCase?: Record<string, unknown> | null;
  snapshots: ReturnType<typeof snapshot>[];
  connections: ReturnType<typeof connection>[];
  scanJobs?: ReturnType<typeof scanJob>[];
}) {
  const calls: Array<{ where: Record<string, unknown> }> = [];
  const tx = {
    assessment: {
      findUnique: () =>
        Promise.resolve({
          id: assessmentId,
          ownerId,
          lifecycleState: ASSESSMENT_LIFECYCLE_STATES.PREPARING,
          lifecycleRevision: 1,
          blockerReason: null,
          blockerReference: null,
          runtime: {
            threadId: randomUUID(),
            rootAgentVersion: "test-setup",
            checkpointNamespace: assessmentId,
            checkpointId: null,
            currentExecutionId: randomUUID(),
            executionState: AGENT_EXECUTION_STATES.RUNNING,
            eventSequence: 0,
            startedAt: new Date("2026-11-04T00:00:00.000Z"),
            lastResumedAt: null,
            updatedAt: new Date("2026-11-04T00:00:00.000Z"),
          },
          domainCase: options.domainCase ?? null,
        }),
    },
    assessmentCaseRepository: {
      findMany: () =>
        Promise.resolve(
          (options.pins ?? []).map((pin, ordinal) => ({ ordinal, ...pin })),
        ),
    },
    repositorySnapshot: {
      findMany: (args: { where: Record<string, unknown> }) => {
        calls.push(args);
        return Promise.resolve(options.snapshots);
      },
    },
    repositoryConnection: {
      findMany: () => Promise.resolve(options.connections),
    },
    repositoryScanJob: {
      findMany: () => Promise.resolve(options.scanJobs ?? []),
    },
  };
  const loader = new AssessmentRepositorySetupLoader({
    $transaction: async (run: (client: typeof tx) => Promise<unknown>) =>
      run(tx),
  } as never);
  return {
    calls,
    load: () =>
      loader.load({
        assessmentId,
        sessionUserId: ownerId,
        subjectRole: AUTH_USER_ROLES.customer,
        correlationId: "setup-view",
      }),
  };
}

describe("AssessmentRepositorySetupLoader", () => {
  afterEach(() => {
    delete process.env[REPOSITORY_LIMIT_ENV];
  });

  it.each([null, "apps/Chat bôt"])(
    "projects a legacy pinned snapshot scope without widening: %s",
    async (sourcePathPrefix) => {
      const pinned = snapshot("snap-1", "c1", { sourcePathPrefix });
      const { load, calls } = loaderFor({
        domainCase: { repositorySnapshotId: "snap-1" },
        snapshots: [pinned],
        connections: [connection("c1")],
      });

      const result = await load();

      expect(calls[0]?.where).toMatchObject({
        id: "snap-1",
        assessmentId,
        status: REPOSITORY_SNAPSHOT_STATUSES.ready,
      });
      expect(result.snapshot).toMatchObject({ id: "snap-1", sourcePathPrefix });
      expect(result.repositories).toHaveLength(1);
    },
  );

  it("lists every candidate repository of an unpinned assessment with the primary mirrored in the legacy fields", async () => {
    const { load } = loaderFor({
      snapshots: [snapshot("snap-b", "c2"), snapshot("snap-a", "c1")],
      connections: [connection("c1"), connection("c2")],
    });

    const result = await load();

    // Candidates are read newest first and shown oldest first.
    expect(result.repositories.map((entry) => entry.snapshot?.id)).toEqual([
      "snap-a",
      "snap-b",
    ]);
    expect(result.repositories.every((entry) => entry.repositoryKey === null)).toBe(
      true,
    );
    expect(result.snapshot?.id).toBe("snap-a");
    expect(result.connection?.connectionId).toBe("c1");
    expect(result.setupCompleted).toBe(false);
    expect(result.repositorySetDigest).toBeNull();
  });

  it("keeps only the newest snapshot per connection and source scope but both scopes of one repository", async () => {
    const { load } = loaderFor({
      snapshots: [
        snapshot("new-web", "c1", {
          sourcePathPrefix: "web",
          createdAt: "2026-11-04T00:00:03.000Z",
        }),
        snapshot("new-admin", "c1", {
          sourcePathPrefix: "admin",
          createdAt: "2026-11-04T00:00:02.000Z",
        }),
        snapshot("old-web", "c1", {
          sourcePathPrefix: "web",
          createdAt: "2026-11-04T00:00:01.000Z",
        }),
      ],
      connections: [connection("c1")],
    });

    const result = await load();

    expect(result.repositories.map((entry) => entry.snapshot?.id)).toEqual([
      "new-admin",
      "new-web",
    ]);
  });

  it("shows a connection that has no snapshot yet as a chosen repository", async () => {
    const { load } = loaderFor({
      snapshots: [snapshot("snap-a", "c1")],
      connections: [connection("c1"), connection("c2")],
    });

    const result = await load();

    expect(result.repositories).toHaveLength(2);
    expect(result.repositories[1]).toMatchObject({
      connection: { connectionId: "c2" },
      snapshot: null,
      scanJob: null,
    });
  });

  it("reports the pinned set in pin order with its keys, hydration tickets and digest", async () => {
    const digest = `sha256:${"b".repeat(64)}`;
    const { load } = loaderFor({
      pins: [
        {
          repositoryKey: "second",
          repositorySnapshotId: "snap-2",
          repositoryScanJobId: "job-2",
        },
        {
          repositoryKey: "first",
          repositorySnapshotId: "snap-1",
          repositoryScanJobId: "job-1",
        },
      ],
      domainCase: {
        repositorySnapshotId: "snap-2",
        repositoryScanJobId: "job-2",
        repositorySetDigest: digest,
      },
      snapshots: [snapshot("snap-1", "c1"), snapshot("snap-2", "c2")],
      connections: [connection("c1"), connection("c2")],
      scanJobs: [scanJob("stale", "snap-1"), scanJob("job-1", "snap-1"), scanJob("job-2", "snap-2")],
    });

    const result = await load();

    expect(
      result.repositories.map((entry) => [
        entry.repositoryKey,
        entry.snapshot?.id,
        entry.scanJob?.id,
      ]),
    ).toEqual([
      ["second", "snap-2", "job-2"],
      ["first", "snap-1", "job-1"],
    ]);
    expect(result.setupCompleted).toBe(true);
    expect(result.repositorySetDigest).toBe(digest);
    expect(result.snapshot?.id).toBe("snap-2");
  });

  it("reports the repository limit the API will enforce", async () => {
    process.env[REPOSITORY_LIMIT_ENV] = "2";
    const { load } = loaderFor({ snapshots: [], connections: [] });
    expect((await load()).repositoryLimit).toBe(2);
  });
});
