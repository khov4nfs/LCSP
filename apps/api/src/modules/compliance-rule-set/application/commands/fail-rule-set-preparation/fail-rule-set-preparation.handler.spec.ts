import { describe, expect, it, jest } from "@jest/globals";
import { AgentExecutionState as State } from "@prisma/client";
import { RULE_SET_PREPARATION_FAILURE_REASONS as R } from "@lcsp/contracts/compliance-rule-set";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { FailRuleSetPreparationCommand } from "./fail-rule-set-preparation.command.js";
import { FailRuleSetPreparationHandler } from "./fail-rule-set-preparation.handler.js";

const id = "42e042e8-6b91-4bfd-8853-108bb4436efa";

function build(executionState: State, failureReason: string | null = null) {
  const row = {
    id,
    legalSourceVersionId: "5ae8f595-1ae6-44a4-b7c1-ef9d4da37598",
    executionState,
    failureReason,
    ruleSet: null as { id: string } | null,
    outboxEventId: "delivery-1",
    claimInventoryRevision: 1,
    claimPhase: "CLAIM_DISCOVERY",
    scopeReviewRequested: false,
    targetActivityScope: "FULL_SOURCE",
    completedAt: null as Date | null,
  };
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([{ id }])),
    ruleSetPreparationRun: {
      findUnique: jest.fn(() => Promise.resolve(row)),
      updateMany: jest.fn(
        ({
          where,
          data,
        }: {
          where: { id: string; executionState: State };
          data: Partial<typeof row>;
        }) => {
          if (where.executionState === row.executionState) {
            Object.assign(row, data);
            return Promise.resolve({ count: 1 });
          }
          return Promise.resolve({ count: 0 });
        },
      ),
    },
  };
  const prisma = {
    $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
  };
  return {
    row,
    tx,
    handler: new FailRuleSetPreparationHandler(
      prisma as unknown as PrismaService,
    ),
  };
}

describe("FailRuleSetPreparationHandler", () => {
  it.each([
    [R.AGENT_BUDGET_REACHED],
    [R.CALL_LIMIT_EXCEEDED],
    [R.TOKEN_LIMIT_EXCEEDED],
    [R.NO_PROGRESS_LIMIT_EXCEEDED],
    [R.BUDGET_EXHAUSTED],
  ] as const)(
    "pauses open run for budget reason %s without terminal completion time",
    async (reason) => {
      const { handler, row } = build(State.RUNNING);
      const result = await handler.execute(
        new FailRuleSetPreparationCommand(
          { preparationRunId: id, reason },
          "corr-1",
        ),
      );
      expect(result.executionState).toBe(State.PAUSED);
      expect(row.failureReason).toBe(R.AGENT_BUDGET_REACHED);
      expect(row.completedAt).toBeNull();
    },
  );

  it("fails open run for non-budget reasons with completion time", async () => {
    const { handler, row } = build(State.RUNNING);
    const result = await handler.execute(
      new FailRuleSetPreparationCommand(
        { preparationRunId: id, reason: R.MODEL_ERROR },
        "corr-2",
      ),
    );
    expect(result.executionState).toBe(State.FAILED);
    expect(row.failureReason).toBe(R.MODEL_ERROR);
    expect(row.completedAt).toBeInstanceOf(Date);
  });

  it("is idempotent when run is already paused for budget", async () => {
    const { handler, row } = build(State.PAUSED, R.CALL_LIMIT_EXCEEDED);
    const result = await handler.execute(
      new FailRuleSetPreparationCommand(
        { preparationRunId: id, reason: R.CALL_LIMIT_EXCEEDED },
        "corr-3",
      ),
    );
    expect(result.executionState).toBe(State.PAUSED);
    expect(row.executionState).toBe(State.PAUSED);
  });

  it("rejects failure settlement on published rule set", async () => {
    const { handler, row } = build(State.RUNNING);
    row.ruleSet = { id: "published-rule-set" };
    await expect(
      handler.execute(
        new FailRuleSetPreparationCommand(
          { preparationRunId: id, reason: R.AGENT_BUDGET_REACHED },
          "corr-4",
        ),
      ),
    ).rejects.toThrow();
  });
});
