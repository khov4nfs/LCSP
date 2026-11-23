import { describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";

import { AssessmentRevisionConflictError } from "../../application/ports/persistence/assessment.repository.js";
import { Assessment } from "../../domain/entities/assessment.entity.js";
import { PrismaAssessmentRepository } from "./prisma-assessment.repository.js";

const assessmentId = "11111111-1111-4111-8111-111111111111";
const ownerId = "22222222-2222-4222-8222-222222222222";
const originalUpdatedAt = new Date("2026-11-20T00:00:00.000Z");

function renamed(name: string): Assessment {
  const assessment = Assessment.rehydrate({
    id: assessmentId,
    ownerId,
    name: "Original name",
    description: null,
    createdAt: new Date("2026-11-01T00:00:00.000Z"),
    updatedAt: originalUpdatedAt,
  });
  assessment.rename(name);
  return assessment;
}

type UpdateManyInput = {
  where: {
    id?: string;
    ownerId?: string;
    updatedAt?: Date;
    deletionFence?: { is: null };
  };
  data: { name?: string; description?: string | null; updatedAt?: Date };
};

type FindFirstInput = {
  where?: { id?: string; ownerId?: string };
  select?: { id?: boolean };
};

function fixture(options: { exists?: boolean; deletionFenced?: boolean } = {}) {
  const state = {
    exists: options.exists ?? true,
    ownerId,
    updatedAt: originalUpdatedAt,
    deletionFenced: options.deletionFenced ?? false,
  };
  const upsert = jest
    .fn<(input: unknown) => Promise<object>>()
    .mockResolvedValue({});
  const create = jest
    .fn<(input: unknown) => Promise<object>>()
    .mockResolvedValue({});
  const update = jest
    .fn<(input: unknown) => Promise<object>>()
    .mockResolvedValue({});
  const updateMany = jest.fn(
    (input: UpdateManyInput): Promise<{ count: number }> => {
      const expectedRevision = input.where.updatedAt;
      const nextRevision = input.data.updatedAt;
      if (
        !state.exists ||
        input.where.id !== assessmentId ||
        input.where.ownerId !== state.ownerId ||
        !expectedRevision ||
        expectedRevision.getTime() !== state.updatedAt.getTime()
      ) {
        return Promise.resolve({ count: 0 });
      }
      if (state.deletionFenced && input.where.deletionFence?.is === null) {
        return Promise.resolve({ count: 0 });
      }
      if (!nextRevision) throw new Error("updatedAt revision is required");
      state.updatedAt = nextRevision;
      return Promise.resolve({ count: 1 });
    },
  );
  const findFirst = jest.fn((input?: FindFirstInput) =>
    Promise.resolve(
      state.exists
        ? input?.select
          ? { id: assessmentId }
          : {
              id: assessmentId,
              ownerId: state.ownerId,
              name: "Persisted assessment",
              description: null,
              createdAt: originalUpdatedAt,
              updatedAt: state.updatedAt,
            }
        : null,
    ),
  );
  const tx = {
    assessment: { create, findFirst, upsert, update, updateMany },
  } as unknown as Prisma.TransactionClient;
  const repository = new PrismaAssessmentRepository(tx as never);
  return {
    repository,
    tx,
    create,
    findFirst,
    state,
    upsert,
    update,
    updateMany,
  };
}

describe("[RED] Prisma assessment rename persistence invariants", () => {
  it("creates a fresh aggregate without upsert and marks public save committed", async () => {
    const { repository, create, upsert } = fixture({ exists: false });
    const assessment = Assessment.create({
      ownerId,
      name: "New assessment",
    });

    await repository.save(assessment);

    expect(create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        id: assessment.id,
        ownerId,
        name: "New assessment",
      }),
    });
    expect(upsert).not.toHaveBeenCalled();
    expect(assessment.isNew).toBe(false);
    expect(assessment.expectedUpdatedAt).toEqual(assessment.updatedAt);
  });

  it("loads an assessment with owner scope at the persistence boundary", async () => {
    const { repository, findFirst } = fixture();

    await expect(
      repository.findByIdForOwner(assessmentId, ownerId),
    ).resolves.toMatchObject({ id: assessmentId, ownerId });

    expect(findFirst).toHaveBeenCalledWith({
      where: { id: assessmentId, ownerId },
    });
  });

  it("keeps transaction-scoped aggregate state uncommitted until its caller commits", async () => {
    const { repository, tx } = fixture({ exists: false });
    const assessment = Assessment.create({
      ownerId,
      name: "New assessment",
    });

    await repository.saveInTx(assessment, tx);

    // saveInTx cannot know whether the surrounding transaction will later
    // commit or roll back, so the application handler owns markPersisted().
    expect(assessment.isNew).toBe(true);
    expect(assessment.expectedUpdatedAt).toBeNull();
  });

  it("[RED][ASM-RENAME-01] rejects one of two stale concurrent renames", async () => {
    const { repository, tx, updateMany } = fixture();

    const outcomes = await Promise.allSettled([
      repository.saveInTx(renamed("First writer"), tx),
      repository.saveInTx(renamed("Second writer"), tx),
    ]);

    // Both writers started from the same persisted revision; a compare-and-set
    // boundary must reject the loser instead of silently overwriting the winner.
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: assessmentId,
          ownerId,
          updatedAt: originalUpdatedAt,
          deletionFence: { is: null },
        },
      }),
    );
  });

  it("rejects a stale writer when the system clock equals the persisted revision", async () => {
    jest.useFakeTimers({ now: originalUpdatedAt });

    try {
      const { repository, tx } = fixture();
      const outcomes = await Promise.allSettled([
        repository.saveInTx(renamed("First writer"), tx),
        repository.saveInTx(renamed("Second writer"), tx),
      ]);

      expect(
        outcomes.filter((outcome) => outcome.status === "rejected"),
      ).toHaveLength(1);
    } finally {
      jest.useRealTimers();
    }
  });

  it("rejects rename writes after deletion cleanup has been fenced", async () => {
    const { repository, tx } = fixture({ deletionFenced: true });

    await expect(
      repository.saveInTx(renamed("Too late to rename"), tx),
    ).rejects.toBeInstanceOf(AssessmentRevisionConflictError);
  });

  it("[RED][ASM-RENAME-02] never recreates a missing assessment during update", async () => {
    const { repository, tx, upsert } = fixture({ exists: false });

    await expect(
      repository.saveInTx(renamed("Updated name"), tx),
    ).rejects.toThrow();

    // Update paths must fail when the row disappeared; upsert would resurrect
    // a deleted assessment and bypass the creation workflow invariants.
    expect(upsert).not.toHaveBeenCalled();
  });

  it("[RED][ASM-RENAME-03] persists the aggregate updatedAt revision", async () => {
    const { repository, tx, update, updateMany } = fixture();
    const assessment = renamed("Updated name");

    await repository.saveInTx(assessment, tx);

    expect(updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ updatedAt: assessment.updatedAt }),
      }),
    );
    expect(update).not.toHaveBeenCalled();
  });
});
