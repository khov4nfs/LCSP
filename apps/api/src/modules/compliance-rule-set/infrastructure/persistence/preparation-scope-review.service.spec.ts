import { describe, expect, it, jest } from "@jest/globals";
import {
  AgentExecutionState,
  ClaimPreparationPhase,
  PreparationScopeReviewState,
  PreparationTargetActivityScope,
} from "@prisma/client";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { PreparationScopeReviewService } from "./preparation-scope-review.service.js";

const runId = "1d9a6370-10e3-47a9-b4c7-a74f06795de1";
const legalSourceVersionId = "6e97605e-66dc-453c-a0bd-4507ae4d1655";

function fixture() {
  const run = {
    id: runId,
    legalSourceVersionId,
    scopeReviewRequested: true,
    executionState: AgentExecutionState.PAUSED as AgentExecutionState,
    claimInventoryRevision: 3,
    claimPhase: ClaimPreparationPhase.CLAIM_INVENTORY_READY,
    targetActivityScope: PreparationTargetActivityScope.FULL_SOURCE,
    ruleSet: null,
  };
  const review = {
    preparationRunId: runId,
    inventoryRevision: 3,
    revision: 1,
    decisionDigest: "a".repeat(64),
    submittedBy: "admin-a",
    approvedBy: null as string | null,
    approvedAt: null as Date | null,
    state: PreparationScopeReviewState.DRAFT,
  };
  const tx = {
    $queryRaw: jest
      .fn<(...args: unknown[]) => Promise<unknown>>()
      .mockResolvedValue([{ id: runId }]),
    ruleSetPreparationRun: {
      findUnique: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(run),
      update: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(run),
    },
    ruleSetPreparationClaimInventory: {
      findUnique: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(null),
      findUniqueOrThrow: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockRejectedValue(new Error("unavailable")),
    },
    ruleSetPreparationScopeReview: {
      findUnique: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(review),
      update: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue(review),
      create: jest.fn<(...args: unknown[]) => Promise<unknown>>(),
    },
  };
  const prisma = {
    $transaction: (fn: (client: typeof tx) => Promise<unknown>) => fn(tx),
    ruleSetPreparationScopeReview: {
      findMany: jest
        .fn<(...args: unknown[]) => Promise<unknown>>()
        .mockResolvedValue([]),
    },
  };
  const service = new PreparationScopeReviewService(
    prisma as unknown as PrismaService,
  );
  return { run, review, tx, service };
}

describe("Preparation scoped review governance", () => {
  it("refuses submission before a frozen review hold and never inserts ledger", async () => {
    const { run, tx, service } = fixture();
    run.scopeReviewRequested = false;
    await expect(
      service.submit(
        runId,
        {
          inventoryRevision: 3,
          inventoryFingerprint: "b".repeat(64),
          expectedReviewRevision: 0,
          decisions: [],
        },
        "admin-a",
        "corr",
      ),
    ).rejects.toThrow();
    expect(tx.ruleSetPreparationScopeReview.create).not.toHaveBeenCalled();
  });

  it("rejects approval by the original submitter without accessing frozen source", async () => {
    const { tx, service } = fixture();
    await expect(
      service.approve(
        runId,
        {
          inventoryRevision: 3,
          expectedReviewRevision: 1,
          decisionDigest: "a".repeat(64),
          confirmsLegalReview: true,
        },
        "admin-a",
        "corr",
      ),
    ).rejects.toThrow();
    expect(
      tx.ruleSetPreparationClaimInventory.findUniqueOrThrow,
    ).not.toHaveBeenCalled();
    expect(tx.ruleSetPreparationScopeReview.update).not.toHaveBeenCalled();
  });

  it("rejects an outdated approval revision without mutation", async () => {
    const { tx, service } = fixture();
    await expect(
      service.approve(
        runId,
        {
          inventoryRevision: 3,
          expectedReviewRevision: 0,
          decisionDigest: "a".repeat(64),
          confirmsLegalReview: true,
        },
        "admin-b",
        "corr",
      ),
    ).rejects.toThrow();
    expect(tx.ruleSetPreparationScopeReview.update).not.toHaveBeenCalled();
  });

  it("refuses DEVELOPMENT_ONLY activation before separate human approval", async () => {
    const { tx, service } = fixture();
    await expect(
      service.activate(runId, 3, "admin-b", "corr"),
    ).rejects.toThrow();
    expect(tx.ruleSetPreparationRun.update).not.toHaveBeenCalled();
  });

  it("never activates when the run is no longer in PAUSED", async () => {
    const { run, tx, service } = fixture();
    run.executionState = AgentExecutionState.RUNNING;
    await expect(
      service.activate(runId, 3, "admin-b", "corr"),
    ).rejects.toThrow();
    expect(tx.ruleSetPreparationRun.update).not.toHaveBeenCalled();
  });
});
