import { expect, it, jest } from "@jest/globals";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { AssessmentDetailLoader } from "./assessment-detail.loader.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

const assessmentId = "22222222-2222-4222-8222-222222222222";
const input = {
  assessmentId,
  sessionUserId: "owner",
  subjectRole: AUTH_USER_ROLES.customer,
  correlationId: "test",
};
function fixture() {
  const row = {
    id: assessmentId,
    name: "Synthetic assessment",
    ownerId: input.sessionUserId,
    lifecycleState: null,
    lifecycleRevision: null,
    blockerReason: null,
    blockerReference: null,
    runtime: null,
    domainCase: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
  const aggregate = jest.fn<() => Promise<unknown>>().mockResolvedValue({
    _sum: { inputTokens: 200001n, outputTokens: 41n, totalTokens: 200042n },
    _count: {
      id: 201,
      inputTokens: 201,
      outputTokens: 201,
      totalTokens: 201,
    },
  });
  const tx = {
    assessment: { findUnique: () => Promise.resolve(row) },
    llmUsageEvent: { aggregate },
  };
  const loader = new AssessmentDetailLoader({
    $transaction: (work: (tx: unknown) => unknown) => Promise.resolve(work(tx)),
  } as unknown as PrismaService);
  return { loader, row, aggregate };
}
it("returns all invocation totals without depending on bounded event history", async () => {
  const { loader, aggregate } = fixture();
  expect((await loader.load(input)).usage).toEqual({
    invocationCount: 201,
    inputTokens: 200001,
    outputTokens: 41,
    totalTokens: 200042,
    partial: false,
  });
  expect(aggregate.mock.calls[0]).toEqual([
    expect.objectContaining({
      where: { assessmentId, userId: input.sessionUserId },
    }),
  ]);
});
it("omits missing provider counters and marks incomplete totals", async () => {
  const { loader, aggregate } = fixture();
  aggregate.mockResolvedValue({
    _sum: { inputTokens: 5n, outputTokens: null, totalTokens: null },
    _count: { id: 2, inputTokens: 1, outputTokens: 0, totalTokens: 0 },
  });
  expect((await loader.load(input)).usage).toEqual({
    invocationCount: 2,
    inputTokens: 5,
    partial: true,
  });
});
it("does not read usage for a foreign assessment", async () => {
  const { loader, row, aggregate } = fixture();
  row.ownerId = "foreign-owner";
  await expect(loader.load(input)).rejects.toThrow();
  expect(aggregate).not.toHaveBeenCalled();
});
