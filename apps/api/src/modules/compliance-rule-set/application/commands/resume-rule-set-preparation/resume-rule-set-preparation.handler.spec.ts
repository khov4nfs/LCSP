import { describe, expect, it, jest } from "@jest/globals";
import { AgentExecutionState as State, Prisma } from "@prisma/client";
import { RULE_SET_PREPARATION_FAILURE_REASONS as R } from "@lcsp/contracts/compliance-rule-set";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { ResumeRuleSetPreparationCommand } from "./resume-rule-set-preparation.command.js";
import { ResumeRuleSetPreparationHandler } from "./resume-rule-set-preparation.handler.js";

const id = "31e042e8-6b91-4bfd-8853-108bb4436efd";
function build(executionState: State, failureReason: string | null) {
  const row = {
    id,
    legalSourceVersionId: "5ae8f595-1ae6-44a4-b7c1-ef9d4da37598",
    executionState,
    failureReason,
    ruleSet: null as { id: string } | null,
    outboxEventId: "previous-delivery",
    claimInventoryRevision: 3,
    draftValidation: {
      outcome: "FAILED",
      failures: [{ code: "LEGAL_REQUIREMENT_UNACCOUNTED", ref: "legalRequirement:art-1" }],
    } as unknown,
  };
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([{ id }])),
    ruleSetPreparationRun: {
      findUnique: jest.fn(() => Promise.resolve(row)),
      update: jest.fn(({ data }: { data: object }) =>
        Promise.resolve(Object.assign(row, data)),
      ),
    },
  };
  const prisma = {
    $transaction: (work: (client: typeof tx) => Promise<unknown>) => work(tx),
  };
  const outbox = { enqueue: jest.fn(() => Promise.resolve("next-delivery")) };
  return {
    row,
    tx,
    outbox,
    handler: new ResumeRuleSetPreparationHandler(
      prisma as unknown as PrismaService,
      outbox as unknown as OutboxRepository,
    ),
  };
}
const command = () =>
  new ResumeRuleSetPreparationCommand(id, "admin-actor", "resume-correlation");

describe("explicit preparation recovery", () => {
  it.each([
    [State.PAUSED, R.AGENT_BUDGET_REACHED],
    [State.FAILED, R.MODEL_ERROR],
    [State.FAILED, R.RUNTIME_ERROR],
  ] as const)(
    "resumes %s/%s with the same run, source and inventory revision",
    async (state, reason) => {
      const { handler, row, tx, outbox } = build(state, reason);
      expect(await handler.execute(command())).toMatchObject({
        preparationRunId: id,
        executionState: State.QUEUED,
      });
      expect(row.claimInventoryRevision).toBe(3);
      expect(row.failureReason).toBeNull();
      expect(row.draftValidation).toBe(Prisma.DbNull);
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(outbox.enqueue).toHaveBeenCalledTimes(1);
      expect(await handler.execute(command())).toMatchObject({
        preparationRunId: id,
        executionState: State.QUEUED,
      });
      expect(outbox.enqueue).toHaveBeenCalledTimes(1);
    },
  );
  it.each([
    [State.CANCELLED, null],
    [State.SUCCEEDED, null],
    [State.FAILED, R.NO_OPERATIVE_OBLIGATIONS],
    [State.FAILED, R.SOURCE_VERSION_UNAVAILABLE],
  ] as const)("refuses terminal %s/%s", async (state, reason) => {
    const { handler, outbox, tx } = build(state, reason);
    await expect(handler.execute(command())).rejects.toThrow();
    expect(outbox.enqueue).not.toHaveBeenCalled();
    expect(tx.ruleSetPreparationRun.update).not.toHaveBeenCalled();
  });
  it("never resumes a run that already published a Rule Set", async () => {
    const { handler, row, outbox } = build(State.FAILED, R.MODEL_ERROR);
    row.ruleSet = { id: "published-artifact" };
    await expect(handler.execute(command())).rejects.toThrow();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });
});
