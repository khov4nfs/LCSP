import { describe, expect, it, jest } from "@jest/globals";
import type { Prisma } from "@prisma/client";

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

function fixture() {
  const upsert = jest.fn(() => Promise.resolve({}));
  const update = jest.fn(() => Promise.resolve({}));
  const updateMany = jest
    .fn<() => Promise<{ count: number }>>()
    .mockResolvedValueOnce({ count: 1 })
    .mockResolvedValueOnce({ count: 0 });
  const tx = {
    assessment: { upsert, update, updateMany },
  } as unknown as Prisma.TransactionClient;
  const repository = new PrismaAssessmentRepository({} as never);
  return { repository, tx, upsert, update, updateMany };
}

describe("[RED] Prisma assessment rename persistence invariants", () => {
  it("[RED][ASM-RENAME-01] rejects one of two stale concurrent renames", async () => {
    const { repository, tx } = fixture();

    const outcomes = await Promise.allSettled([
      repository.saveInTx(renamed("First writer"), tx),
      repository.saveInTx(renamed("Second writer"), tx),
    ]);

    // Both writers started from the same persisted revision; a compare-and-set
    // boundary must reject the loser instead of silently overwriting the winner.
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
  });

  it("[RED][ASM-RENAME-02] never recreates a missing assessment during update", async () => {
    const { repository, tx, upsert } = fixture();

    await repository.saveInTx(renamed("Updated name"), tx);

    // Update paths must fail when the row disappeared; upsert would resurrect
    // a deleted assessment and bypass the creation workflow invariants.
    expect(upsert).not.toHaveBeenCalled();
  });

  it("[RED][ASM-RENAME-03] persists the aggregate updatedAt revision", async () => {
    const { repository, tx, update } = fixture();
    const assessment = renamed("Updated name");

    await repository.saveInTx(assessment, tx);

    expect(update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ updatedAt: assessment.updatedAt }),
      }),
    );
  });
});
