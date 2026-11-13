import { describe, expect, it, jest } from "@jest/globals";
import {
  AgentExecutionState,
  LegalSourceLifecycleStatus,
  Prisma,
} from "@prisma/client";

import type { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import type { OutboxRepository } from "../../../../../platform/outbox/outbox.repository.js";
import { StartRuleSetPreparationCommand } from "./start-rule-set-preparation.command.js";
import { StartRuleSetPreparationHandler } from "./start-rule-set-preparation.handler.js";

const LEGAL_SOURCE_VERSION_ID = "7dd20acf-0480-4f7d-8cfe-009f47e50622";
const IDEMPOTENCY_KEY = "start-preparation-test-key";

function retryableConflict() {
  return Object.assign(
    new Error("Transaction failed due to a write conflict or a deadlock"),
    { code: "P2034" },
  );
}

function createHarness(
  createRun: (attempt: number) => {
    id: string;
    legalSourceVersionId: string;
    executionState: AgentExecutionState;
  },
  retryableCommitFailures = 0,
) {
  const transactionOptions: unknown[] = [];
  const outboxWritesByAttempt = new Map<number, number>();
  const committed = { runs: 0, outboxMessages: 0 };
  let currentAttempt = 0;
  const transactions: Array<{
    $queryRaw: ReturnType<typeof jest.fn>;
    ruleSetPreparationRun: {
      findUnique: ReturnType<typeof jest.fn>;
      create: ReturnType<typeof jest.fn>;
      update: ReturnType<typeof jest.fn>;
    };
    legalSourceVersion: { findUnique: ReturnType<typeof jest.fn> };
  }> = [];

  const $transaction = jest.fn(
    (
      callback: (tx: never) => Promise<unknown>,
      options?: unknown,
    ): Promise<unknown> => {
      transactionOptions.push(options);
      const attempt = transactions.length + 1;
      currentAttempt = attempt;
      const tx = {
        $queryRaw: jest
          .fn<() => Promise<unknown[]>>()
          .mockResolvedValue([{ acquired: true }]),
        ruleSetPreparationRun: {
          findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue(null),
          create: jest
            .fn<() => Promise<unknown>>()
            .mockImplementation(() => Promise.resolve(createRun(attempt))),
          update: jest
            .fn<() => Promise<unknown>>()
            .mockResolvedValue(undefined),
        },
        legalSourceVersion: {
          findUnique: jest.fn<() => Promise<unknown>>().mockResolvedValue({
            id: LEGAL_SOURCE_VERSION_ID,
            status: LegalSourceLifecycleStatus.ACTIVE,
          }),
        },
      };
      transactions.push(tx);
      return callback(tx as never).then((result) => {
        if (attempt <= retryableCommitFailures) throw retryableConflict();
        committed.runs += tx.ruleSetPreparationRun.create.mock.calls.length;
        committed.outboxMessages += outboxWritesByAttempt.get(attempt) ?? 0;
        return result;
      });
    },
  );
  const prisma = { $transaction } as unknown as PrismaService;
  const enqueue = jest.fn<() => Promise<string>>().mockImplementation(() => {
    const writes = outboxWritesByAttempt.get(currentAttempt) ?? 0;
    outboxWritesByAttempt.set(currentAttempt, writes + 1);
    return Promise.resolve("outbox-event-id");
  });
  const outbox = {
    enqueue,
  } as unknown as OutboxRepository;
  const handler = new StartRuleSetPreparationHandler(prisma, outbox);
  const command = new StartRuleSetPreparationCommand(
    {
      legalSourceVersionId: LEGAL_SOURCE_VERSION_ID,
      idempotencyKey: IDEMPOTENCY_KEY,
    },
    "test-admin",
    "correlation-start-retry",
  );

  return {
    $transaction,
    transactionOptions,
    transactions,
    enqueue,
    committed,
    handler,
    command,
  };
}

describe("StartRuleSetPreparationHandler serialization retry", () => {
  it("retries the entire Serializable transaction and writes one run/outbox event", async () => {
    const run = {
      id: "f4dc44ad-5c95-4896-bdb1-2a49e8971edc",
      legalSourceVersionId: LEGAL_SOURCE_VERSION_ID,
      executionState: AgentExecutionState.QUEUED,
    };
    const harness = createHarness(() => run, 1);

    await expect(harness.handler.execute(harness.command)).resolves.toEqual({
      preparationRunId: run.id,
      legalSourceVersionId: LEGAL_SOURCE_VERSION_ID,
      executionState: AgentExecutionState.QUEUED,
      ruleSetVersionId: null,
    });

    expect(harness.$transaction.mock.calls).toHaveLength(2);
    for (const tx of harness.transactions) {
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.ruleSetPreparationRun.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.legalSourceVersion.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.ruleSetPreparationRun.create).toHaveBeenCalledTimes(1);
    }
    expect(harness.transactionOptions).toEqual([
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    ]);
    expect(harness.enqueue.mock.calls).toHaveLength(2);
    expect(harness.committed).toEqual({ runs: 1, outboxMessages: 1 });
  });

  it("propagates the final retryable error after the bounded attempt limit", async () => {
    const harness = createHarness(
      () => ({
        id: "f4dc44ad-5c95-4896-bdb1-2a49e8971edc",
        legalSourceVersionId: LEGAL_SOURCE_VERSION_ID,
        executionState: AgentExecutionState.QUEUED,
      }),
      4,
    );

    await expect(
      harness.handler.execute(harness.command),
    ).rejects.toMatchObject({ code: "P2034" });

    expect(harness.$transaction.mock.calls).toHaveLength(4);
    expect(harness.transactions).toHaveLength(4);
    for (const tx of harness.transactions) {
      expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
      expect(tx.ruleSetPreparationRun.findUnique).toHaveBeenCalledTimes(1);
      expect(tx.legalSourceVersion.findUnique).toHaveBeenCalledTimes(1);
    }
    expect(harness.enqueue.mock.calls).toHaveLength(4);
    expect(harness.committed).toEqual({ runs: 0, outboxMessages: 0 });
  });

  it("does not retry permanent persistence errors", async () => {
    const permanent = Object.assign(new Error("Foreign key violation"), {
      code: "P2003",
    });
    const harness = createHarness(() => {
      throw permanent;
    });

    await expect(harness.handler.execute(harness.command)).rejects.toBe(
      permanent,
    );

    expect(harness.$transaction.mock.calls).toHaveLength(1);
    expect(harness.enqueue.mock.calls).toHaveLength(0);
    expect(harness.committed).toEqual({ runs: 0, outboxMessages: 0 });
  });
});
