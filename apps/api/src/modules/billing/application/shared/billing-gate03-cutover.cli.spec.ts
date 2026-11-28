import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, jest } from "@jest/globals";
import {
  BACKFILL_BATCH_SIZE,
  assertPermittedCutoverDatasource,
  runBillingGate03CutoverCli,
  type BillingGate03PrismaClient,
} from "../../../../../scripts/billing-gate03-cutover.js";

type FakeLedgerRow = {
  id: string;
  walletId: string;
  userId: string;
  deltaCredits: bigint;
  deltaMicrocredits: bigint | null;
  accountingUnitVersion: number;
  idempotencyKey: string;
  source: string;
  ledgerSource: null;
  referenceId: string | null;
  billingOrderId: string | null;
  createdAt: Date;
};

function createBackfillFakePrisma(
  initialRows: FakeLedgerRow[],
  options: { updateCountOverride?: number } = {},
) {
  const rows = initialRows.map((r) => ({ ...r }));
  const findManyCalls: Array<{ take?: number }> = [];
  const updateManyCalls: Array<{ id: string }> = [];
  const disconnect = jest.fn(async () => {
    await Promise.resolve();
  });

  const client: BillingGate03PrismaClient = {
    $disconnect: disconnect,
    $transaction: jest.fn(
      async (fn: (tx: BillingGate03PrismaClient) => Promise<unknown>) => {
        return await fn(client);
      },
    ) as unknown as BillingGate03PrismaClient["$transaction"],
    $executeRaw: jest.fn(() => Promise.resolve(0)),
    creditLedgerEntry: {
      count: jest.fn(async (args?: { where?: { deltaMicrocredits: null } }) => {
        await Promise.resolve();
        if (args?.where?.deltaMicrocredits === null) {
          return rows.filter((r) => r.deltaMicrocredits === null).length;
        }
        return rows.length;
      }),
      findMany: jest.fn(
        async (args?: {
          where?: { deltaMicrocredits?: null; walletId?: string };
          take?: number;
        }) => {
          await Promise.resolve();
          findManyCalls.push({ take: args?.take });
          let filtered = rows;
          if (args?.where?.deltaMicrocredits === null) {
            filtered = filtered.filter((r) => r.deltaMicrocredits === null);
          }
          if (args?.where?.walletId) {
            filtered = filtered.filter(
              (r) => r.walletId === args.where!.walletId,
            );
          }
          return typeof args?.take === "number"
            ? filtered.slice(0, args.take).map((r) => ({ ...r }))
            : filtered.map((r) => ({ ...r }));
        },
      ),
      updateMany: jest.fn(
        async (args: {
          where: { id: string; deltaMicrocredits: null };
          data: { deltaMicrocredits: bigint; accountingUnitVersion: number };
        }) => {
          await Promise.resolve();
          updateManyCalls.push({ id: args.where.id });
          if (options.updateCountOverride !== undefined) {
            return { count: options.updateCountOverride };
          }
          const target = rows.find(
            (r) => r.id === args.where.id && r.deltaMicrocredits === null,
          );
          if (!target) {
            return { count: 0 };
          }
          target.deltaMicrocredits = args.data.deltaMicrocredits;
          target.accountingUnitVersion = args.data.accountingUnitVersion;
          return { count: 1 };
        },
      ),
    },
    billingWallet: {
      findMany: jest.fn(async () => {
        await Promise.resolve();
        return [];
      }),
      findUnique: jest.fn(async () => {
        await Promise.resolve();
        return null;
      }),
      updateMany: jest.fn(async () => {
        await Promise.resolve();
        return { count: 0 };
      }),
    },
    billingReservation: {
      findMany: jest.fn(async () => {
        await Promise.resolve();
        return [];
      }),
    },
  };

  return { client, rows, findManyCalls, updateManyCalls, disconnect };
}

describe("GATE-03 Cutover CLI (R4 Direct Tests)", () => {
  const validLocalUrl =
    "postgresql://fogewise:localpw@127.0.0.1:5432/lcsp_local";

  it("permits only 127.0.0.1:5432/lcsp_local and rejects unexpected datasource targets", () => {
    const parsed = assertPermittedCutoverDatasource(validLocalUrl);
    expect(parsed.hostname).toBe("127.0.0.1");
    expect(parsed.port).toBe("5432");
    expect(parsed.pathname).toBe("/lcsp_local");

    const rejectedTargets = [
      "postgresql://postgres:secretpw@127.0.0.1:55432/lcsp_api_test?schema=public",
      "postgresql://fogewise:secretpw@localhost:5432/lcsp_local",
      "postgresql://fogewise:secretpw@127.0.0.1:5432/lcsp_prod",
      "postgresql://fogewise:secretpw@127.0.0.1:5433/lcsp_local",
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
      "mysql://fogewise:secretpw@127.0.0.1:5432/lcsp_local",
      "not-a-valid-url",
    ];

    for (const target of rejectedTargets) {
      expect(() => assertPermittedCutoverDatasource(target)).toThrow();
    }
  });

  it("rejects invalid/unexpected target URL across all 5 modes with zero DB connections, queries, or mutations", async () => {
    const modes: string[][] = [
      ["--audit"],
      ["--reconcile"],
      ["--backfill"],
      ["--cutover", "wallet-1"],
      ["--rollback", "wallet-1"],
    ];
    const invalidUrls = [
      "postgresql://postgres:secretpw@127.0.0.1:55432/lcsp_api_test?schema=public",
      "postgresql://fogewise:secretpw@localhost:5432/lcsp_local",
      "postgresql://fogewise:secretpw@127.0.0.1:5432/lcsp_prod",
      "postgresql://fogewise:secretpw@127.0.0.1:5433/lcsp_local",
      "not-a-valid-url",
    ];

    for (const args of modes) {
      for (const badUrl of invalidUrls) {
        const createPrismaClient = jest.fn<
          (url: string) => BillingGate03PrismaClient
        >(() => {
          throw new Error("createPrismaClient must never be called");
        });
        const logs: string[] = [];
        const errors: string[] = [];

        const exitCode = await runBillingGate03CutoverCli(args, {
          resolveDatasourceUrl: () => badUrl,
          createPrismaClient,
          log: (m) => logs.push(m),
          warn: (m) => logs.push(m),
          error: (m) => errors.push(m),
        });

        expect(exitCode).toBe(1);
        expect(createPrismaClient).not.toHaveBeenCalled();
        expect(logs.join("\n")).not.toContain("Connected to database");
        expect(errors.join("\n")).not.toContain("secretpw");
      }
    }
  });

  it("real tsx CLI subprocess rejects unexpected DATABASE_URL immediately without connecting", async () => {
    const apiDir = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../../../..",
    );
    // Use process.execPath (node) with --import tsx to avoid tsx CLI daemon IPC sockets
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", "scripts/billing-gate03-cutover.ts", "--audit"],
      {
        cwd: apiDir,
        env: {
          ...process.env,
          DATABASE_URL:
            "postgresql://postgres:secretpw@127.0.0.1:59999/lcsp_prod",
          MIGRATION_DATABASE_URL: "",
        },
        encoding: "utf8",
        timeout: 15000,
      },
    );

    const combinedOutput = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
    const isSandboxRestricted =
      Boolean(
        result.error &&
        ["EPERM", "EACCES"].includes(
          (result.error as NodeJS.ErrnoException).code ?? "",
        ),
      ) ||
      (result.status !== 0 &&
        /EPERM|operation not permitted/i.test(combinedOutput) &&
        !combinedOutput.includes("127.0.0.1:5432/lcsp_local"));

    if (isSandboxRestricted) {
      // In restricted test environments where child process creation or local sockets are denied with EPERM/EACCES,
      // acknowledge the environment constraint and assert the in-process guard directly.
      const logs: string[] = [];
      const errors: string[] = [];
      const exitCode = await runBillingGate03CutoverCli(["--audit"], {
        resolveDatasourceUrl: () =>
          "postgresql://postgres:secretpw@127.0.0.1:59999/lcsp_prod",
        createPrismaClient: () => {
          throw new Error("createPrismaClient must never be called");
        },
        log: (m) => logs.push(m),
        warn: (m) => logs.push(m),
        error: (m) => errors.push(m),
      });

      expect(exitCode).toBe(1);
      const combined = `${logs.join("\n")}\n${errors.join("\n")}`;
      expect(combined).not.toContain("Connected to database");
      expect(combined).not.toContain("secretpw");
      expect(combined).toContain("127.0.0.1:5432/lcsp_local");
      return;
    }

    expect(result.status).not.toBe(0);
    expect(combinedOutput).not.toContain("Connected to database");
    expect(combinedOutput).not.toContain("secretpw");
    expect(combinedOutput).toContain("127.0.0.1:5432/lcsp_local");
  });

  it("--backfill loops across batches for > 500 records (1,250 rows in 3 batches) until 0 remaining", async () => {
    expect(BACKFILL_BATCH_SIZE).toBe(500);
    const totalRows = 1250;
    const initialRows: FakeLedgerRow[] = Array.from(
      { length: totalRows },
      (_, idx) => ({
        id: `entry-${idx + 1}`,
        walletId: "w-1",
        userId: "u-1",
        deltaCredits: 10n,
        deltaMicrocredits: null,
        accountingUnitVersion: 1,
        idempotencyKey: `order-${idx + 1}:credit`,
        source: "BILLING_ORDER_CREDIT",
        ledgerSource: null,
        referenceId: `order-${idx + 1}`,
        billingOrderId: `order-${idx + 1}`,
        createdAt: new Date(1_700_000_000_000 + idx),
      }),
    );

    const fake = createBackfillFakePrisma(initialRows);
    const logs: string[] = [];
    const errors: string[] = [];

    const exitCode = await runBillingGate03CutoverCli(["--backfill"], {
      resolveDatasourceUrl: () => validLocalUrl,
      createPrismaClient: () => fake.client,
      log: (m) => logs.push(m),
      warn: (m) => logs.push(m),
      error: (m) => errors.push(m),
    });

    expect(exitCode).toBe(0);
    expect(errors).toHaveLength(0);
    expect(fake.findManyCalls).toHaveLength(3);
    expect(fake.findManyCalls.every((c) => c.take === 500)).toBe(true);
    expect(fake.updateManyCalls).toHaveLength(1250);
    expect(fake.rows.every((r) => r.deltaMicrocredits === 10_000_000n)).toBe(
      true,
    );
    expect(
      await fake.client.creditLedgerEntry.count({
        where: { deltaMicrocredits: null },
      }),
    ).toBe(0);

    const joinedLogs = logs.join("\n");
    expect(joinedLogs).toContain("remaining=750");
    expect(joinedLogs).toContain("remaining=250");
    expect(joinedLogs).toContain("remaining=0");
    expect(joinedLogs).toContain("Backfill complete");
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
  });

  it("--backfill returns non-zero exit code on no-progress / incomplete batch without printing Backfill complete", async () => {
    const initialRows: FakeLedgerRow[] = Array.from(
      { length: 10 },
      (_, idx) => ({
        id: `entry-stall-${idx + 1}`,
        walletId: "w-1",
        userId: "u-1",
        deltaCredits: 5n,
        deltaMicrocredits: null,
        accountingUnitVersion: 1,
        idempotencyKey: `order-stall-${idx + 1}:credit`,
        source: "BILLING_ORDER_CREDIT",
        ledgerSource: null,
        referenceId: `order-stall-${idx + 1}`,
        billingOrderId: `order-stall-${idx + 1}`,
        createdAt: new Date(1_700_000_000_000 + idx),
      }),
    );

    const fake = createBackfillFakePrisma(initialRows, {
      updateCountOverride: 0,
    });
    const logs: string[] = [];
    const errors: string[] = [];

    const exitCode = await runBillingGate03CutoverCli(["--backfill"], {
      resolveDatasourceUrl: () => validLocalUrl,
      createPrismaClient: () => fake.client,
      log: (m) => logs.push(m),
      warn: (m) => logs.push(m),
      error: (m) => errors.push(m),
    });

    expect(exitCode).toBe(1);
    expect(fake.findManyCalls).toHaveLength(1);
    expect(logs.join("\n")).not.toContain("Backfill complete");
    expect(errors.join("\n")).toMatch(/no progress|remaining/i);
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
  });

  it("--backfill succeeds cleanly with 0 unmigrated rows", async () => {
    const fake = createBackfillFakePrisma([]);
    const logs: string[] = [];
    const errors: string[] = [];

    const exitCode = await runBillingGate03CutoverCli(["--backfill"], {
      resolveDatasourceUrl: () => validLocalUrl,
      createPrismaClient: () => fake.client,
      log: (m) => logs.push(m),
      warn: (m) => logs.push(m),
      error: (m) => errors.push(m),
    });

    expect(exitCode).toBe(0);
    expect(errors).toHaveLength(0);
    expect(fake.findManyCalls).toHaveLength(0);
    expect(logs.join("\n")).toContain("Remaining: 0");
    expect(fake.disconnect).toHaveBeenCalledTimes(1);
  });
});
