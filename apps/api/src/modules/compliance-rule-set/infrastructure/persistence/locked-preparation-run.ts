import { Prisma, type RuleSetPreparationRun } from "@prisma/client";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";

/**
 * Business purpose: Serialize one Preparation operation against other review, inventory, cancellation, and publication writes.
 * Business rules:
 * - The caller owns all business decisions inside this transaction; the run is read only after its row lock is acquired.
 * - A missing run is returned as null so each command retains its existing failure contract.
 * Execution flow:
 * 1. Open one bounded transaction. 2. Lock the requested run row. 3. Load its current state and invoke the caller.
 * Failure cases:
 * - Database or callback errors roll back the complete operation; a missing row is decided by the caller.
 * Side effects:
 * - Holds a PostgreSQL row lock while the callback executes and commits or rolls back its writes atomically.
 */
export function withLockedPreparationRun<T>(
  prisma: PrismaService,
  preparationRunId: string,
  work: (
    tx: Prisma.TransactionClient,
    run: RuleSetPreparationRun | null,
  ) => Promise<T>,
): Promise<T> {
  // Why: Both review and inventory must observe the run under the same lock order.
  // How: The adapter owns transaction setup and current-state loading, then yields the same tx to the command.
  // Invariant: No nested transaction or pre-lock run read can weaken the cancellation/publication fence.
  return prisma.$transaction(
    async (tx) => {
      await tx.$queryRaw(
        Prisma.sql`SELECT id FROM "RuleSetPreparationRun" WHERE id=${preparationRunId} FOR UPDATE`,
      );
      const run = await tx.ruleSetPreparationRun.findUnique({
        where: { id: preparationRunId },
      });
      return work(tx, run);
    },
    { timeout: 30_000 },
  );
}
