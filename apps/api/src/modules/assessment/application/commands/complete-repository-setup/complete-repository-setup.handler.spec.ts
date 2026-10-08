import { describe, expect, it, jest } from "@jest/globals";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { CompleteRepositorySetupCommand } from "./complete-repository-setup.command.js";
import { CompleteRepositorySetupHandler } from "./complete-repository-setup.handler.js";

const id = "11111111-1111-4111-8111-111111111111";
function context(
  state: string | null = ASSESSMENT_LIFECYCLE_STATES.PREPARING,
  snapshot: unknown = { id: "snapshot", commitSha: "a".repeat(40) },
) {
  const row = {
    id,
    ownerId: "owner",
    lifecycleState: state,
    domainCase: {
      repositorySnapshotId:
        state === ASSESSMENT_LIFECYCLE_STATES.ACTIVE ? "snapshot" : null,
    },
  };
  const prepare = jest
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({});
  const audit = jest
    .fn<(...args: unknown[]) => Promise<void>>()
    .mockResolvedValue();
  const snapshotRead = jest
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue(snapshot);
  const tx = {
    $queryRaw: () => Promise.resolve([]),
    assessment: { findUnique: () => Promise.resolve(row) },
    repositoryConnection: {
      findFirst: () => Promise.resolve({ id: "connection" }),
    },
    repositorySnapshot: { findFirst: snapshotRead },
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
  };
}
const command = (owner = "owner") =>
  new CompleteRepositorySetupCommand(id, owner, "corr");
describe("canonical repository setup", () => {
  it("prepares only through the existing authority in one transaction", async () => {
    const ctx = context();
    const result = await ctx.handler.execute(command());
    expect(result).toEqual({
      assessment_id: id,
      repository_connection_id: "connection",
      snapshot_id: "snapshot",
      commit_sha: "a".repeat(40),
    });
    expect(ctx.prepare).toHaveBeenCalledWith(
      ctx.tx,
      expect.objectContaining({ assessmentId: id, snapshotId: "snapshot" }),
    );
    expect(ctx.audit).toHaveBeenCalledTimes(1);
  });
  it("replays the existing ACTIVE pin without another preparation or audit", async () => {
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
});
