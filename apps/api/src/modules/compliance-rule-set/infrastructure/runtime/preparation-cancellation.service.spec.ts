import { describe, expect, it, jest } from "@jest/globals";
import { AgentExecutionState } from "@prisma/client";
import type { CommandBus } from "@nestjs/cqrs";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { PreparationCancellationService } from "./preparation-cancellation.service.js";

const RUN_ID = "31e042e8-6b91-4bfd-8853-108bb4436efd";
const CORRELATION_ID = "preparation-correlation";

function build() {
  let state: AgentExecutionState = AgentExecutionState.CANCEL_REQUESTED;
  const tx = {
    $queryRaw: jest.fn(() => Promise.resolve([{ id: RUN_ID }])),
    ruleSetPreparationRun: {
      updateMany: jest.fn(
        ({ where }: { where: { executionState: AgentExecutionState } }) => {
          if (state !== where.executionState)
            return Promise.resolve({ count: 0 });
          state = AgentExecutionState.CANCELLED;
          return Promise.resolve({ count: 1 });
        },
      ),
    },
  };
  const prisma = {
    ruleSetPreparationRun: {
      findMany: jest.fn(() =>
        Promise.resolve(
          state === AgentExecutionState.CANCEL_REQUESTED
            ? [{ id: RUN_ID, correlationId: CORRELATION_ID }]
            : [],
        ),
      ),
    },
    $transaction: jest.fn((work: (client: typeof tx) => Promise<unknown>) =>
      work(tx),
    ),
  };
  const runtime = { cancel: jest.fn(() => Promise.resolve()) };
  const commands = {
    execute: jest.fn(() => Promise.resolve({ recorded: true })),
  };
  const service = new PreparationCancellationService(
    prisma as unknown as PrismaService,
    runtime,
    commands as unknown as CommandBus,
  );
  return { service, prisma, tx, runtime, commands, getState: () => state };
}

describe("Durable preparation cancellation", () => {
  it("advances past a bounded batch of failing requests so later runs are retried", async () => {
    const { service, prisma, runtime } = build();
    const seenCursors: Array<string | undefined> = [];
    prisma.ruleSetPreparationRun.findMany.mockImplementation(
      (query?: unknown) => {
        const cursor = (
          query as { where?: { id?: { gt?: string } } } | undefined
        )?.where?.id?.gt;
        seenCursors.push(cursor);
        const rows = Array.from({ length: 26 }, (_, index) => ({
          id: String(index + 1).padStart(2, "0"),
          correlationId: `correlation-${index + 1}`,
        }));
        return Promise.resolve(
          rows.filter((row) => !cursor || row.id > cursor).slice(0, 25),
        );
      },
    );
    runtime.cancel.mockRejectedValue(new Error("unavailable"));
    await service.poll();
    await service.poll();
    expect(seenCursors).toEqual([undefined, "25"]);
    expect(runtime.cancel).toHaveBeenCalledTimes(26);
  });

  it("keeps the run pending when Agent Server has not confirmed a stop", async () => {
    const { service, runtime, tx, getState } = build();
    // A cooperative cancellation may still be in flight; retain the durable retry request.
    runtime.cancel.mockRejectedValue(new Error("native run still running"));
    await service.poll();
    expect(getState()).toBe(AgentExecutionState.CANCEL_REQUESTED);
    expect(tx.ruleSetPreparationRun.updateMany).not.toHaveBeenCalled();
  });

  it("closes the run once after native stop and does not redispatch on a later poll", async () => {
    const { service, runtime, tx, getState, commands } = build();
    await service.poll();
    await service.poll();
    expect(getState()).toBe(AgentExecutionState.CANCELLED);
    expect(runtime.cancel).toHaveBeenCalledTimes(1);
    expect(tx.ruleSetPreparationRun.updateMany).toHaveBeenCalledTimes(1);
    expect(commands.execute).toHaveBeenCalledTimes(1);
  });
});
