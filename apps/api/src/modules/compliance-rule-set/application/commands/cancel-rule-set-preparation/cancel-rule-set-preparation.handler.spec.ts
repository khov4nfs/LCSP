import { describe, expect, it, jest } from "@jest/globals";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import {
  AGENT_STREAM_BOUNDARY_TYPES,
  ASSESSMENT_AGENT_STREAM_EVENT_TYPES,
} from "@lcsp/contracts/evidence";
import type { CommandBus } from "@nestjs/cqrs";
import { AgentExecutionState as PrismaAgentExecutionState } from "@prisma/client";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { CancelRuleSetPreparationCommand } from "./cancel-rule-set-preparation.command.js";
import { CancelRuleSetPreparationHandler } from "./cancel-rule-set-preparation.handler.js";

const RUN_ID = "31e042e8-6b91-4bfd-8853-108bb4436efd";
const SOURCE_ID = "5ae8f595-1ae6-44a4-b7c1-ef9d4da37598";
const CORRELATION_ID = "preparation-correlation";

function build(state: PrismaAgentExecutionState) {
  const row = {
    id: RUN_ID,
    legalSourceVersionId: SOURCE_ID,
    correlationId: CORRELATION_ID,
    executionState: state,
    failureReason: null,
    completedAt: null as Date | null,
    ruleSet: null as { id: string } | null,
  };
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([{ id: RUN_ID }])),
    ruleSetPreparationRun: {
      findUnique: jest.fn(() => Promise.resolve(row)),
      updateMany: jest.fn((input: unknown) => {
        void input;
        return Promise.resolve({ count: 1 });
      }),
    },
    complianceRuleSetVersion: {
      findFirst: jest.fn(() => Promise.resolve(null as { id: string } | null)),
    },
  };
  const prisma = {
    $transaction: jest.fn(
      async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
    ),
  };
  const runtime = {
    cancel: jest.fn((correlationId: string) => {
      void correlationId;
      return Promise.resolve();
    }),
  };
  const commands = {
    execute: jest.fn((command: unknown) => {
      void command;
      return Promise.resolve({ recorded: true });
    }),
  };
  const handler = new CancelRuleSetPreparationHandler(
    prisma as unknown as PrismaService,
    runtime,
    commands as unknown as CommandBus,
  );
  return { handler, row, tx, runtime, commands };
}

const command = () =>
  new CancelRuleSetPreparationCommand(RUN_ID, "request-correlation");

describe("Cancel Rule Set Preparation", () => {
  it("cancels QUEUED without contacting Agent Server or starting model work", async () => {
    const { handler, row, tx, runtime, commands } = build(
      PrismaAgentExecutionState.QUEUED,
    );

    const result = await handler.execute(command());

    expect(result.executionState).toBe(AGENT_EXECUTION_STATES.CANCELLED);
    expect(result.ruleSetVersionId).toBeNull();
    expect(tx.ruleSetPreparationRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: RUN_ID, executionState: PrismaAgentExecutionState.QUEUED },
        data: expect.objectContaining({
          executionState: PrismaAgentExecutionState.CANCELLED,
          failureReason: null,
          completedAt: expect.any(Date),
        }),
      }),
    );
    expect(row.executionState).toBe(PrismaAgentExecutionState.QUEUED);
    expect(runtime.cancel).not.toHaveBeenCalled();
    expect(commands.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          run_id: RUN_ID,
          preparation_run_id: RUN_ID,
          event_type: ASSESSMENT_AGENT_STREAM_EVENT_TYPES.preparationCancelled,
          data: expect.objectContaining({
            boundary_type: AGENT_STREAM_BOUNDARY_TYPES.ruleSetPreparation,
            execution_state: AGENT_EXECUTION_STATES.CANCELLED,
          }),
        }),
      }),
    );
  });

  it("requests native cancellation exactly once before settling a RUNNING run", async () => {
    const order: string[] = [];
    const { handler, tx, runtime } = build(PrismaAgentExecutionState.RUNNING);
    runtime.cancel.mockImplementation((correlationId: string) => {
      void correlationId;
      order.push("native-cancel");
      return Promise.resolve();
    });
    tx.ruleSetPreparationRun.updateMany.mockImplementation(() => {
      order.push("domain-settle");
      return Promise.resolve({ count: 1 });
    });

    const result = await handler.execute(command());

    expect(runtime.cancel).toHaveBeenCalledTimes(1);
    expect(runtime.cancel).toHaveBeenCalledWith(CORRELATION_ID);
    expect(order).toEqual(["native-cancel", "domain-settle"]);
    expect(result.executionState).toBe(AGENT_EXECUTION_STATES.CANCELLED);
  });

  it("is idempotent for an already CANCELLED run and preserves its terminal time", async () => {
    const { handler, row, tx, runtime, commands } = build(
      PrismaAgentExecutionState.CANCELLED,
    );
    const completedAt = new Date("2026-10-13T02:00:00.000Z");
    row.completedAt = completedAt;

    const result = await handler.execute(command());

    expect(result.executionState).toBe(AGENT_EXECUTION_STATES.CANCELLED);
    expect(tx.ruleSetPreparationRun.updateMany).not.toHaveBeenCalled();
    expect(runtime.cancel).not.toHaveBeenCalled();
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it.each([
    PrismaAgentExecutionState.SUCCEEDED,
    PrismaAgentExecutionState.FAILED,
    PrismaAgentExecutionState.INTERRUPTED,
    PrismaAgentExecutionState.PAUSED,
  ])("refuses cancellation from terminal/control state %s", async (state) => {
    const { handler, tx, runtime } = build(state);

    await expect(handler.execute(command())).rejects.toMatchObject({
      status: 409,
    });

    expect(tx.ruleSetPreparationRun.updateMany).not.toHaveBeenCalled();
    expect(runtime.cancel).not.toHaveBeenCalled();
  });

  it("does not settle the domain when native cancellation fails", async () => {
    const { handler, tx, runtime, commands } = build(
      PrismaAgentExecutionState.RUNNING,
    );
    runtime.cancel.mockRejectedValue(new Error("transport unavailable"));

    await expect(handler.execute(command())).rejects.toThrow();

    expect(tx.ruleSetPreparationRun.updateMany).not.toHaveBeenCalled();
    expect(commands.execute).not.toHaveBeenCalled();
  });

  it("refuses cancellation if a rule set has already been activated", async () => {
    const { handler, tx, runtime } = build(PrismaAgentExecutionState.RUNNING);
    tx.complianceRuleSetVersion.findFirst.mockResolvedValue({
      id: "active-id",
    });

    await expect(handler.execute(command())).rejects.toMatchObject({
      status: 409,
    });

    expect(runtime.cancel).not.toHaveBeenCalled();
    expect(tx.ruleSetPreparationRun.updateMany).not.toHaveBeenCalled();
  });
});
