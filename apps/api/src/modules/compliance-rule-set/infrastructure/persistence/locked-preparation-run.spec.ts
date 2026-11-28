import { describe, expect, it, jest } from "@jest/globals";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { withLockedPreparationRun } from "./locked-preparation-run.js";

describe("Preparation run transaction boundary", () => {
  it("locks the run before reading it and gives both commands the same transaction", async () => {
    const order: string[] = [];
    const run = { id: "run-id" };
    const tx = {
      $queryRaw: jest.fn(() => {
        order.push("lock");
        return Promise.resolve([{ id: run.id }]);
      }),
      ruleSetPreparationRun: {
        findUnique: jest.fn(() => {
          order.push("load");
          return Promise.resolve(run);
        }),
      },
    };
    const prisma = {
      $transaction: jest.fn(
        async (work: (client: typeof tx) => Promise<unknown>) => work(tx),
      ),
    };

    const result = await withLockedPreparationRun(
      prisma as unknown as PrismaService,
      run.id,
      (client, current) => {
        order.push("work");
        expect(client).toBe(tx);
        return Promise.resolve(current?.id);
      },
    );

    expect(result).toBe(run.id);
    expect(order).toEqual(["lock", "load", "work"]);
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
  });
});
