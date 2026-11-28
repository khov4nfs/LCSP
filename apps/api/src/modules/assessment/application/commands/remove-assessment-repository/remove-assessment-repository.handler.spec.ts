import { describe, expect, it, jest } from "@jest/globals";
import { ASSESSMENT_LIFECYCLE_STATES } from "@lcsp/contracts/assessment";
import { REPOSITORY_SET_ERROR_CODES } from "@lcsp/contracts/assessment-domain";
import { RemoveAssessmentRepositoryCommand } from "./remove-assessment-repository.command.js";
import { RemoveAssessmentRepositoryHandler } from "./remove-assessment-repository.handler.js";

const assessmentId = "11111111-1111-4111-8111-111111111111";

function context(
  options: {
    state?: string | null;
    owner?: string;
    pinned?: number;
    snapshot?: { id: string; connectionId: string; repositoryFullName: string } | null;
    remaining?: number;
  } = {},
) {
  const snapshotDelete = jest
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({});
  const connectionUpdate = jest
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue({});
  const snapshotFind = jest
    .fn<(...args: unknown[]) => Promise<unknown>>()
    .mockResolvedValue(
      options.snapshot === undefined
        ? { id: "snap-1", connectionId: "c1", repositoryFullName: "acme/web" }
        : options.snapshot,
    );
  const audit = jest
    .fn<(...args: unknown[]) => Promise<void>>()
    .mockResolvedValue();
  const tx = {
    $queryRaw: () => Promise.resolve([]),
    assessment: {
      findUnique: () =>
        Promise.resolve({
          id: assessmentId,
          ownerId: options.owner ?? "owner",
          lifecycleState:
            options.state === undefined
              ? ASSESSMENT_LIFECYCLE_STATES.PREPARING
              : options.state,
        }),
    },
    assessmentCaseRepository: {
      count: () => Promise.resolve(options.pinned ?? 0),
    },
    repositorySnapshot: {
      findFirst: snapshotFind,
      delete: snapshotDelete,
      count: () => Promise.resolve(options.remaining ?? 0),
    },
    repositoryConnection: { update: connectionUpdate },
  };
  const handler = new RemoveAssessmentRepositoryHandler(
    {
      $transaction: async (run: (client: typeof tx) => Promise<unknown>) =>
        run(tx),
    } as never,
    { writeInTx: audit } as never,
  );
  return { handler, snapshotDelete, connectionUpdate, snapshotFind, audit };
}

const command = (actor = "owner") =>
  new RemoveAssessmentRepositoryCommand(assessmentId, "snap-1", actor, "corr");

describe("RemoveAssessmentRepositoryHandler", () => {
  it("deletes the candidate snapshot, revokes a connection nothing else uses and audits it", async () => {
    const ctx = context({ remaining: 0 });

    await expect(ctx.handler.execute(command())).resolves.toEqual({
      assessment_id: assessmentId,
      snapshot_id: "snap-1",
      connection_id: "c1",
      connection_revoked: true,
    });

    expect(ctx.snapshotDelete).toHaveBeenCalledWith({ where: { id: "snap-1" } });
    expect(ctx.connectionUpdate).toHaveBeenCalledWith({
      where: { id: "c1" },
      data: { status: "REVOKED" },
    });
    expect(ctx.audit).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: "ASSESSMENT_REPOSITORY_REMOVED",
        payload: expect.objectContaining({
          snapshotId: "snap-1",
          connectionRevoked: true,
        }),
      }),
      expect.anything(),
    );
  });

  it("keeps the connection when it still has another snapshot (a second source scope)", async () => {
    const ctx = context({ remaining: 1 });

    await expect(ctx.handler.execute(command())).resolves.toMatchObject({
      connection_revoked: false,
    });
    expect(ctx.connectionUpdate).not.toHaveBeenCalled();
  });

  it("only looks up snapshots of this assessment on the customer's own connections", async () => {
    const ctx = context();
    await ctx.handler.execute(command());
    expect(ctx.snapshotFind).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "snap-1",
          assessmentId,
          connection: { userId: "owner" },
        }),
      }),
    );
  });

  it("refuses once the repository set is pinned because it is immutable", async () => {
    const ctx = context({ pinned: 2 });

    await expect(ctx.handler.execute(command())).rejects.toMatchObject({
      status: 409,
      response: { problem: { code: REPOSITORY_SET_ERROR_CODES.immutable } },
    });
    expect(ctx.snapshotDelete).not.toHaveBeenCalled();
    expect(ctx.audit).not.toHaveBeenCalled();
  });

  it.each([
    ASSESSMENT_LIFECYCLE_STATES.ACTIVE,
    ASSESSMENT_LIFECYCLE_STATES.PAUSED,
    ASSESSMENT_LIFECYCLE_STATES.COMPLETE,
    null,
  ])("refuses outside the setup lifecycle (%s)", async (state) => {
    const ctx = context({ state });
    await expect(ctx.handler.execute(command())).rejects.toMatchObject({
      status: 409,
    });
    expect(ctx.snapshotDelete).not.toHaveBeenCalled();
  });

  it("hides foreign assessments and unknown snapshots", async () => {
    await expect(
      context().handler.execute(command("someone-else")),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      context({ snapshot: null }).handler.execute(command()),
    ).rejects.toMatchObject({ status: 404 });
  });
});
