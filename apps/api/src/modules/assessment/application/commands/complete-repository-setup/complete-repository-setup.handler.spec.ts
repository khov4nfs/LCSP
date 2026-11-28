import { describe, expect, it, jest } from "@jest/globals";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { CompleteRepositorySetupCommand } from "./complete-repository-setup.command.js";
import { CompleteRepositorySetupHandler } from "./complete-repository-setup.handler.js";

const id = "11111111-1111-4111-8111-111111111111";
const DIGEST = `sha256:${"c".repeat(64)}`;
const commit = (char: string) => char.repeat(40);

type Pin = {
  repositoryKey: string;
  connectionId: string;
  repositorySnapshotId: string;
  repositoryCommit: string;
};

function context(
  state: string | null = ASSESSMENT_LIFECYCLE_STATES.PREPARING,
  snapshot: unknown = { id: "snapshot", commitSha: commit("a") },
  options: {
    pins?: Pin[];
    pinsAfterPrepare?: Pin[];
    snapshotRows?: Array<{ id: string; commitSha: string; connectionId: string }>;
  } = {},
) {
  const row = {
    id,
    ownerId: "owner",
    lifecycleState: state,
    domainCase: {
      repositorySnapshotId:
        state === ASSESSMENT_LIFECYCLE_STATES.ACTIVE ? "snapshot" : null,
      repositorySetDigest: DIGEST,
    },
  };
  let prepared = false;
  const prepare = jest
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockImplementation(() => {
      prepared = true;
      return Promise.resolve({});
    });
  const audit = jest
    .fn<(...args: unknown[]) => Promise<void>>()
    .mockResolvedValue();
  const snapshotRead = jest
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue(snapshot);
  const snapshotList = jest
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue(options.snapshotRows ?? []);
  const tx = {
    $queryRaw: jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue([]),
    assessment: { findUnique: () => Promise.resolve(row) },
    assessmentCase: {
      findUnique: () => Promise.resolve({ repositorySetDigest: DIGEST }),
    },
    assessmentCaseRepository: {
      findMany: () =>
        Promise.resolve(
          prepared ? (options.pinsAfterPrepare ?? []) : (options.pins ?? []),
        ),
    },
    repositoryConnection: {
      findFirst: () => Promise.resolve({ id: "connection" }),
    },
    repositorySnapshot: { findFirst: snapshotRead, findMany: snapshotList },
  };
  const prisma = {
    $transaction: async (run: (tx: unknown) => Promise<unknown>) => run(tx),
  };
  return {
    handler: new CompleteRepositorySetupHandler(
      prisma as never,
      { writeInTx: audit } as never,
      { prepareInTx: prepare } as never,
    ),
    prepare,
    audit,
    tx,
    snapshotRead,
    snapshotList,
  };
}
const command = (owner = "owner", snapshotIds?: string[]) =>
  new CompleteRepositorySetupCommand(id, owner, "corr", null, snapshotIds);

describe("canonical repository setup", () => {
  it("prepares only through the existing authority in one transaction", async () => {
    const ctx = context();
    const result = await ctx.handler.execute(command());
    expect(result).toEqual({
      assessment_id: id,
      repository_connection_id: "connection",
      snapshot_id: "snapshot",
      commit_sha: commit("a"),
      repositories: [],
    });
    expect(ctx.prepare).toHaveBeenCalledWith(
      ctx.tx,
      expect.objectContaining({ assessmentId: id, snapshotIds: ["snapshot"] }),
    );
    expect(ctx.audit).toHaveBeenCalledTimes(1);
  });

  it("answers from the pinned set after preparation, primary first, with the set digest", async () => {
    const pins: Pin[] = [
      {
        repositoryKey: "web",
        connectionId: "c1",
        repositorySnapshotId: "snap-1",
        repositoryCommit: commit("a"),
      },
      {
        repositoryKey: "api",
        connectionId: "c2",
        repositorySnapshotId: "snap-2",
        repositoryCommit: commit("b"),
      },
    ];
    const ctx = context(ASSESSMENT_LIFECYCLE_STATES.PREPARING, null, {
      pinsAfterPrepare: pins,
      snapshotRows: [
        { id: "snap-1", commitSha: commit("a"), connectionId: "c1" },
        { id: "snap-2", commitSha: commit("b"), connectionId: "c2" },
      ],
    });

    const result = await ctx.handler.execute(
      command("owner", ["snap-1", "snap-2"]),
    );

    expect(ctx.prepare).toHaveBeenCalledWith(
      ctx.tx,
      expect.objectContaining({ snapshotIds: ["snap-1", "snap-2"] }),
    );
    expect(result).toMatchObject({
      repository_connection_id: "c1",
      snapshot_id: "snap-1",
      repository_set_digest: DIGEST,
      repositories: [
        { repository_key: "web", snapshot_id: "snap-1", connection_id: "c1" },
        { repository_key: "api", snapshot_id: "snap-2", connection_id: "c2" },
      ],
    });
    expect(ctx.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          repositories: [
            { connectionId: "c1", snapshotId: "snap-1", commitSha: commit("a") },
            { connectionId: "c2", snapshotId: "snap-2", commitSha: commit("b") },
          ],
        }),
      }),
      ctx.tx,
    );
  });

  it("only accepts named snapshots that are ready, on this assessment and on an active connection of the owner", async () => {
    const ctx = context(ASSESSMENT_LIFECYCLE_STATES.PREPARING, null, {
      snapshotRows: [{ id: "snap-1", commitSha: commit("a"), connectionId: "c1" }],
    });

    await ctx.handler.execute(command("owner", ["snap-1"])).catch(() => null);

    expect(ctx.snapshotList).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: { in: ["snap-1"] },
          assessmentId: id,
          status: "READY",
          connection: expect.objectContaining({
            userId: "owner",
            status: "ACTIVE",
          }),
        }),
      }),
    );
  });

  it("names every missing or unusable snapshot and pins nothing", async () => {
    const ctx = context(ASSESSMENT_LIFECYCLE_STATES.PREPARING, null, {
      snapshotRows: [
        { id: "snap-1", commitSha: commit("a"), connectionId: "c1" },
        { id: "snap-bad", commitSha: "not-a-commit", connectionId: "c3" },
      ],
    });

    await expect(
      ctx.handler.execute(
        command("owner", ["snap-1", "snap-bad", "snap-gone"]),
      ),
    ).rejects.toMatchObject({
      status: 409,
      response: {
        problem: { meta: { missingSnapshotIds: "snap-bad,snap-gone" } },
      },
    });
    expect(ctx.prepare).not.toHaveBeenCalled();
    expect(ctx.audit).not.toHaveBeenCalled();
  });

  it("replays an ACTIVE assessment from its pinned set without preparing or auditing again", async () => {
    const ctx = context(ASSESSMENT_LIFECYCLE_STATES.ACTIVE, null, {
      pins: [
        {
          repositoryKey: "web",
          connectionId: "c1",
          repositorySnapshotId: "snap-1",
          repositoryCommit: commit("a"),
        },
      ],
    });

    const result = await ctx.handler.execute(command());

    expect(result).toMatchObject({
      snapshot_id: "snap-1",
      repository_set_digest: DIGEST,
      repositories: [{ repository_key: "web" }],
    });
    expect(ctx.prepare).not.toHaveBeenCalled();
    expect(ctx.audit).not.toHaveBeenCalled();
    expect(ctx.snapshotRead).not.toHaveBeenCalled();
  });

  it("replays the existing ACTIVE pin of a legacy case without another preparation or audit", async () => {
    const ctx = context(ASSESSMENT_LIFECYCLE_STATES.ACTIVE);
    await ctx.handler.execute(command());
    expect(ctx.prepare).not.toHaveBeenCalled();
    expect(ctx.audit).not.toHaveBeenCalled();
    expect(ctx.snapshotRead).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "snapshot" }),
      }),
    );
  });

  it.each([
    null,
    ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
    ASSESSMENT_LIFECYCLE_STATES.PAUSED,
  ])("rejects unavailable or advanced lifecycle %s", async (state) => {
    await expect(
      context(state).handler.execute(command()),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("rejects missing repository prerequisites", async () => {
    await expect(
      context(ASSESSMENT_LIFECYCLE_STATES.PREPARING, null).handler.execute(
        command(),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it("hides foreign ownership", async () => {
    await expect(
      context().handler.execute(command("another")),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("reproducer: scopes the exclusive row lock to ownerId to prevent cross-tenant DoS", async () => {
    let capturedQueryText = "";
    const ctx = context();
    ctx.tx.$queryRaw.mockImplementation((query: unknown) => {
      capturedQueryText = JSON.stringify(query);
      return Promise.resolve([{ id }]);
    });
    await ctx.handler.execute(command());
    // In compliant code, ownerId MUST be checked in the SQL query itself
    expect(capturedQueryText).toContain("ownerId");
  });
});
