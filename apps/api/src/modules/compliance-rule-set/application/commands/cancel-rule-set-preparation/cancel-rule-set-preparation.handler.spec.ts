import { describe, expect, it, jest } from "@jest/globals";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import { AgentExecutionState as PrismaAgentExecutionState } from "@prisma/client";
import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { PreparationCancellationService } from "../../../infrastructure/runtime/preparation-cancellation.service.js";
import type { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
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
  const cancellation = {
    publishCancellationActivity: jest.fn(
      (runId: string, correlationId: string) => {
        void runId;
        void correlationId;
        return Promise.resolve();
      },
    ),
  };
  const audit = {
    writeInTx: jest.fn((_event: unknown, _tx: unknown) => {
      void _event;
      void _tx;
      return Promise.resolve();
    }),
  };
  const handler = new CancelRuleSetPreparationHandler(
    prisma as unknown as PrismaService,
    cancellation as unknown as PreparationCancellationService,
    audit as unknown as AuditWriterService,
  );
  return { handler, row, tx, cancellation, audit };
}

const command = () =>
  new CancelRuleSetPreparationCommand(
    RUN_ID,
    "request-correlation",
    "admin-id",
  );

describe("Cancel Rule Set Preparation", () => {
  it("cancels QUEUED without contacting Agent Server or starting model work", async () => {
    const { handler, row, tx, cancellation } = build(
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
    expect(cancellation.publishCancellationActivity).toHaveBeenCalledWith(
      RUN_ID,
      CORRELATION_ID,
    );
  });

  it("commits a durable stop request without contacting Agent Server inside the transaction", async () => {
    const order: string[] = [];
    const { handler, tx, cancellation } = build(
      PrismaAgentExecutionState.RUNNING,
    );
    tx.ruleSetPreparationRun.updateMany.mockImplementation(() => {
      order.push("domain-settle");
      return Promise.resolve({ count: 1 });
    });

    const result = await handler.execute(command());

    expect(order).toEqual(["domain-settle"]);
    expect(result.executionState).toBe(AGENT_EXECUTION_STATES.CANCEL_REQUESTED);
    expect(cancellation.publishCancellationActivity).not.toHaveBeenCalled();
  });

  it("records the cancellation actor in the same transaction as the state change", async () => {
    const { handler, audit, tx } = build(PrismaAgentExecutionState.RUNNING);
    await handler.execute(command());
    expect(audit.writeInTx).toHaveBeenCalledWith(
      expect.objectContaining({
        actorId: "admin-id",
        resourceId: SOURCE_ID,
        correlationId: "request-correlation",
        payload: expect.objectContaining({ preparationRunId: RUN_ID }),
      }),
      tx,
    );
  });

  it("does not stop the native run before the database cancellation commits", async () => {
    const { handler, cancellation, tx } = build(
      PrismaAgentExecutionState.RUNNING,
    );
    // A transport cancellation cannot roll back with the database transaction.
    // Keep the worker running if the state update fails before commit.
    tx.ruleSetPreparationRun.updateMany.mockResolvedValue({ count: 0 });

    await expect(handler.execute(command())).rejects.toMatchObject({
      status: 409,
    });
    expect(cancellation.publishCancellationActivity).not.toHaveBeenCalled();
  });

  it("is idempotent for an already CANCELLED run and preserves its terminal time", async () => {
    const { handler, row, tx, cancellation } = build(
      PrismaAgentExecutionState.CANCELLED,
    );
    const completedAt = new Date("2026-10-13T02:00:00.000Z");
    row.completedAt = completedAt;

    const result = await handler.execute(command());

    expect(result.executionState).toBe(AGENT_EXECUTION_STATES.CANCELLED);
    expect(tx.ruleSetPreparationRun.updateMany).not.toHaveBeenCalled();
    expect(cancellation.publishCancellationActivity).not.toHaveBeenCalled();
  });

  it.each([
    PrismaAgentExecutionState.SUCCEEDED,
    PrismaAgentExecutionState.FAILED,
    PrismaAgentExecutionState.INTERRUPTED,
  ])("refuses cancellation from terminal/control state %s", async (state) => {
    const { handler, tx, cancellation } = build(state);

    await expect(handler.execute(command())).rejects.toMatchObject({
      status: 409,
    });

    expect(tx.ruleSetPreparationRun.updateMany).not.toHaveBeenCalled();
    expect(cancellation.publishCancellationActivity).not.toHaveBeenCalled();
  });

  it("cancels a PAUSED run without an active worker", async () => {
    const { handler, cancellation } = build(PrismaAgentExecutionState.PAUSED);
    expect(await handler.execute(command())).toMatchObject({
      executionState: AGENT_EXECUTION_STATES.CANCELLED,
    });
    expect(cancellation.publishCancellationActivity).toHaveBeenCalledTimes(1);
  });

  it("replays a pending cancellation without another state change", async () => {
    const { handler, tx, cancellation } = build(
      PrismaAgentExecutionState.CANCEL_REQUESTED,
    );
    expect(await handler.execute(command())).toMatchObject({
      executionState: AGENT_EXECUTION_STATES.CANCEL_REQUESTED,
    });
    expect(tx.ruleSetPreparationRun.updateMany).not.toHaveBeenCalled();
    expect(cancellation.publishCancellationActivity).not.toHaveBeenCalled();
  });

  it("refuses cancellation of a run that already published its rule set", async () => {
    const { handler, row, tx, cancellation } = build(
      PrismaAgentExecutionState.RUNNING,
    );
    row.ruleSet = { id: "published-by-this-run" };

    await expect(handler.execute(command())).rejects.toMatchObject({
      status: 409,
    });

    expect(cancellation.publishCancellationActivity).not.toHaveBeenCalled();
    expect(tx.ruleSetPreparationRun.updateMany).not.toHaveBeenCalled();
  });

  it("cancels a replacement run while the source's previous rule set stays ACTIVE", async () => {
    const { handler, tx, cancellation } = build(
      PrismaAgentExecutionState.RUNNING,
    );
    // An ACTIVE rule set of the same source belongs to an earlier run; it is neither read nor touched.
    tx.complianceRuleSetVersion.findFirst.mockResolvedValue({
      id: "v1-active",
    });

    const result = await handler.execute(command());

    expect(result.executionState).toBe(AGENT_EXECUTION_STATES.CANCEL_REQUESTED);
    expect(cancellation.publishCancellationActivity).not.toHaveBeenCalled();
    expect(tx.complianceRuleSetVersion.findFirst).not.toHaveBeenCalled();
  });
});
