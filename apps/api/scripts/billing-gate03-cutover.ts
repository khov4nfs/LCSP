/**
 * GATE-03 Operational Cutover & Reconciliation Tooling
 *
 * Usage:
 *   pnpm --dir apps/api exec tsx scripts/billing-gate03-cutover.ts --audit
 *   pnpm --dir apps/api exec tsx scripts/billing-gate03-cutover.ts --backfill
 *   pnpm --dir apps/api exec tsx scripts/billing-gate03-cutover.ts --cutover <walletId>
 *   pnpm --dir apps/api exec tsx scripts/billing-gate03-cutover.ts --rollback <walletId>
 */

import { realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { resolveDatasourceUrl } from "../prisma.config.js";
import {
  BillingCutoverService,
  WALLET_CUTOVER_STATUSES,
} from "../src/modules/billing/application/shared/billing-cutover.service.js";
import { PrismaBillingTransaction } from "../src/modules/billing/infrastructure/persistence/prisma-billing-transaction.js";
import {
  type PrismaService,
  prismaConnectionConfig,
} from "../src/infrastructure/prisma/prisma.service.js";

export const BACKFILL_BATCH_SIZE = 500;

const PERMITTED_HOST = "127.0.0.1";
const PERMITTED_PORT = "5432";
const PERMITTED_PATHNAME = "/lcsp_local";

export interface BillingGate03PrismaClient {
  $disconnect: () => Promise<void>;
  $transaction: <T>(
    fn: (tx: BillingGate03PrismaClient) => Promise<T>,
  ) => Promise<T>;
  $executeRaw?: (...args: unknown[]) => Promise<unknown>;
  creditLedgerEntry: {
    count: (args?: { where?: { deltaMicrocredits: null } }) => Promise<number>;
    findMany: (args?: {
      where?: { deltaMicrocredits?: null; walletId?: string };
      take?: number;
      orderBy?: { createdAt: "asc" | "desc" };
    }) => Promise<
      Array<{
        id: string;
        walletId: string;
        userId: string;
        deltaCredits: bigint;
        deltaMicrocredits: bigint | null;
        accountingUnitVersion: number;
        idempotencyKey: string;
        source: string;
        ledgerSource: null | string;
        referenceId: string | null;
        billingOrderId: string | null;
        admissionId?: string | null;
        originalLedgerEntryId?: string | null;
      }>
    >;
    updateMany: (args: {
      where: { id: string; deltaMicrocredits: null };
      data: { deltaMicrocredits: bigint; accountingUnitVersion: number };
    }) => Promise<{ count: number }>;
  };
  billingWallet: {
    findMany: (args?: {
      select?: { id: true; userId: true; accountingUnitVersion: true };
    }) => Promise<
      Array<{ id: string; userId: string; accountingUnitVersion: number }>
    >;
    findUnique: (args: { where: { id: string } }) => Promise<{
      id: string;
      userId: string;
      availableCredits: bigint;
      reservedCredits: bigint;
      balanceMicrocredits: bigint;
      accountingUnitVersion: number;
      version: number;
    } | null>;
    updateMany: (args: unknown) => Promise<{ count: number }>;
  };
  billingReservation: {
    findMany: (args: unknown) => Promise<unknown[]>;
  };
}

export interface BillingGate03CliDeps {
  resolveDatasourceUrl?: () => string;
  createPrismaClient?: (targetUrl: string) => BillingGate03PrismaClient;
  log?: (message: string) => void;
  warn?: (message: string) => void;
  error?: (message: string) => void;
}

/**
 * Business purpose: Enforce that GATE-03 cutover CLI operations target only the
 *   approved local database (`127.0.0.1:5432/lcsp_local`) before any connection is opened.
 *
 * Business rules:
 * - Only `postgresql:` or `postgres:` URLs pointing to host `127.0.0.1`, port `5432`,
 *   and database path `/lcsp_local` are permitted in this phase.
 * - Rejects `localhost`, test/e2e ports, remote hosts, wrong database names, and malformed URLs.
 * - Never includes raw credentials in thrown error messages.
 *
 * Execution flow:
 * 1. Parse `targetUrl` using `new URL(targetUrl)`.
 * 2. Validate `protocol`, `hostname`, `port`, and `pathname` against the strict allowlist.
 * 3. Return the validated `URL` instance.
 *
 * Failure cases:
 * - Throws an `Error` with a sanitized target description if parsing or allowlist checks fail.
 *
 * Side effects:
 * - Pure validation; opens no network sockets and performs no database queries.
 */
export function assertPermittedCutoverDatasource(targetUrl: string): URL {
  // Why: Running cutover, backfill, or audit scripts against an unintended test, staging, or
  // production datasource risks corrupting live billing state before Phase B2 readiness.
  // How: Strictly validate protocol, IPv4 loopback host 127.0.0.1, port 5432, and path /lcsp_local
  // immediately after resolveDatasourceUrl() and before PrismaPg/PrismaClient instantiation.
  // Invariants: Raw URL credentials are never echoed in exceptions.
  let parsed: URL;
  try {
    parsed = new URL(targetUrl);
  } catch {
    throw new Error(
      `Refusing GATE-03 execution: invalid datasource URL. Only ${PERMITTED_HOST}:${PERMITTED_PORT}${PERMITTED_PATHNAME} is permitted.`,
    );
  }

  const isPostgresProtocol =
    parsed.protocol === "postgresql:" || parsed.protocol === "postgres:";
  if (
    !isPostgresProtocol ||
    parsed.hostname !== PERMITTED_HOST ||
    parsed.port !== PERMITTED_PORT ||
    parsed.pathname !== PERMITTED_PATHNAME
  ) {
    throw new Error(
      `Refusing GATE-03 execution: datasource '${parsed.protocol}//${parsed.hostname}:${parsed.port}${parsed.pathname}' is not permitted. Only ${PERMITTED_HOST}:${PERMITTED_PORT}${PERMITTED_PATHNAME} is permitted.`,
    );
  }

  return parsed;
}

/**
 * Business purpose: Backfill all historical `CreditLedgerEntry` rows with `deltaMicrocredits = null`
 *   in bounded batches until zero unmigrated rows remain or a stall is detected.
 *
 * Business rules:
 * - Processes batches of `BACKFILL_BATCH_SIZE` (`500`) rows per iteration.
 * - Reports batch progress and remaining unmigrated count after every batch.
 * - Fails closed with exit code `1` if any unmigrated rows remain after a no-progress batch,
 *   without emitting `"Backfill complete"`.
 *
 * Execution flow:
 * 1. Count remaining unmigrated `CreditLedgerEntry` rows (`deltaMicrocredits: null`).
 * 2. Loop while `remaining > 0`, invoking `backfillHistoricalLedgerEntries(BACKFILL_BATCH_SIZE)`
 *    and re-counting `remaining`.
 * 3. Abort with exit code `1` if a batch makes zero progress (`processed === 0` or `totalBackfilled === 0`
 *    while `remaining >= remainingBefore`).
 * 4. Emit completion summary and return `0` only when `remaining === 0`.
 *
 * Failure cases:
 * - Returns `1` on stalled or incomplete backfill runs.
 * - Propagates unexpected database errors to the CLI runner.
 *
 * Side effects:
 * - Updates historical `CreditLedgerEntry.deltaMicrocredits` via `BillingCutoverService`.
 */
async function runBackfillBatches(
  prisma: BillingGate03PrismaClient,
  cutoverService: BillingCutoverService,
  log: (message: string) => void,
  error: (message: string) => void,
): Promise<number> {
  // Why: A single backfillHistoricalLedgerEntries(500) call truncates datasets larger than 500 rows
  // while claiming completion, leaving unmigrated rows that block cutover.
  // How: Loop in batches of BACKFILL_BATCH_SIZE while re-counting unmigrated rows, failing immediately
  // if a batch makes no progress so the operator gets an accurate non-zero exit code.
  // Invariants: "Backfill complete" is printed only when remaining === 0.
  let remaining = await prisma.creditLedgerEntry.count({
    where: { deltaMicrocredits: null },
  });
  let batchNumber = 0;
  let totalProcessed = 0;
  let totalBackfilled = 0;

  while (remaining > 0) {
    batchNumber += 1;
    const remainingBefore = remaining;
    const batch =
      await cutoverService.backfillHistoricalLedgerEntries(BACKFILL_BATCH_SIZE);
    totalProcessed += batch.processed;
    totalBackfilled += batch.totalBackfilled;
    remaining = await prisma.creditLedgerEntry.count({
      where: { deltaMicrocredits: null },
    });

    log(
      `[GATE-03] Backfill batch ${batchNumber}: processed=${batch.processed}, backfilled=${batch.totalBackfilled}, totalBackfilled=${totalBackfilled}, remaining=${remaining}`,
    );

    if (
      remaining > 0 &&
      (batch.processed === 0 ||
        (batch.totalBackfilled === 0 && remaining >= remainingBefore))
    ) {
      error(
        `[GATE-03] Backfill failed: no progress made (${remaining} unmigrated rows remaining).`,
      );
      return 1;
    }
  }

  if (remaining !== 0) {
    error(
      `[GATE-03] Backfill incomplete: ${remaining} unmigrated rows remaining.`,
    );
    return 1;
  }

  log(
    `[GATE-03] Backfill complete. Batches: ${batchNumber}, Processed: ${totalProcessed}, Newly backfilled: ${totalBackfilled}, Remaining: 0`,
  );
  return 0;
}

/**
 * Business purpose: Execute the GATE-03 operational CLI workflow (`--audit`, `--reconcile`,
 *   `--backfill`, `--cutover <walletId>`, `--rollback <walletId>`) against the validated local DB.
 *
 * Business rules:
 * - Validates the datasource URL via `assertPermittedCutoverDatasource` BEFORE creating any
 *   database adapter/client, logging connection status, or running any query/mutation.
 * - Always disconnects the created Prisma client in `finally`.
 * - Returns non-zero exit code `1` for invalid datasources, missing wallet arguments, unknown
 *   modes, stalled/incomplete backfills, or domain/database failures.
 *
 * Execution flow:
 * 1. Resolve and validate the datasource URL; abort immediately with `1` if disallowed.
 * 2. Construct the Prisma client and `BillingCutoverService` backed by `PrismaBillingTransaction`.
 * 3. Dispatch the requested mode (`--backfill`, `--audit`/`--reconcile`, `--cutover`, `--rollback`).
 * 4. Disconnect Prisma cleanly in `finally` and return the integer exit code.
 *
 * Failure cases:
 * - Returns `1` on datasource guard failure without calling `createPrismaClient`.
 * - Returns `1` on unknown mode, missing `<walletId>`, missing wallet, or stalled backfill.
 *
 * Side effects:
 * - Depending on mode, reads or mutates `BillingWallet` / `CreditLedgerEntry` in `127.0.0.1:5432/lcsp_local`.
 */
export async function runBillingGate03CutoverCli(
  args: string[],
  deps: BillingGate03CliDeps = {},
): Promise<number> {
  // Why: Separating the CLI runner from module top-level side effects and checking the datasource
  // before client creation prevents accidental connections to non-local DBs and enables direct testing.
  // How: Validate resolveDatasourceUrl() first, instantiate Prisma only on success, return numeric exit
  // codes instead of mid-function process.exit(), and guarantee $disconnect() in finally.
  // Invariants: Zero DB connections or queries ever occur when assertPermittedCutoverDatasource throws.
  const mode = args[0] ?? "--audit";
  const resolveUrl = deps.resolveDatasourceUrl ?? resolveDatasourceUrl;
  const log = deps.log ?? console.log;
  const warn = deps.warn ?? console.warn;
  const error = deps.error ?? console.error;

  let targetUrl: string;
  let parsed: URL;
  try {
    targetUrl = resolveUrl();
    parsed = assertPermittedCutoverDatasource(targetUrl);
  } catch (err) {
    error(err instanceof Error ? err.message : String(err));
    return 1;
  }

  log(
    `[GATE-03] Connected to database: ${parsed.protocol}//***:***@${parsed.hostname}:${parsed.port}${parsed.pathname}`,
  );

  const createClient =
    deps.createPrismaClient ??
    ((url: string) =>
      new PrismaClient({
        adapter: new PrismaPg(
          prismaConnectionConfig(url, process.env.PGOPTIONS ?? ""),
        ),
      }) as unknown as BillingGate03PrismaClient);

  const prisma = createClient(targetUrl);
  const prismaService = prisma as unknown as PrismaService;
  const txPort = new PrismaBillingTransaction(prismaService);
  const cutoverService = new BillingCutoverService(
    txPort,
    undefined,
    prismaService,
  );

  try {
    if (mode === "--backfill") {
      log(
        "[GATE-03] Starting idempotent backfill of historical CreditLedgerEntry rows...",
      );
      return await runBackfillBatches(prisma, cutoverService, log, error);
    }

    if (mode === "--audit" || mode === "--reconcile") {
      log(
        "[GATE-03] Running per-wallet reconciliation audit across all wallets...",
      );
      const wallets = await prisma.billingWallet.findMany({
        select: { id: true, userId: true, accountingUnitVersion: true },
      });

      log(`[GATE-03] Found ${wallets.length} wallets.`);
      let matchCount = 0;
      let unmigratedCount = 0;
      let mismatchCount = 0;

      for (const w of wallets) {
        const report = await cutoverService.reconcileWallet(w.id);
        if (report.status === WALLET_CUTOVER_STATUSES.MATCH) {
          matchCount += 1;
        } else if (report.status === WALLET_CUTOVER_STATUSES.UNMIGRATED) {
          unmigratedCount += 1;
          warn(
            `[UNMIGRATED] Wallet ${w.id} (User: ${w.userId}) has ${report.unmigratedEntriesCount} unmigrated entries.`,
          );
        } else {
          mismatchCount += 1;
          error(
            `[MISMATCH ALARM] Wallet ${w.id} (User: ${w.userId}) parity drift: ${report.parityDifferenceMicrocredits} microcredits.`,
          );
        }
      }

      log("\n================ RECONCILIATION SUMMARY ================");
      log(`Total Wallets: ${wallets.length}`);
      log(`MATCH:        ${matchCount}`);
      log(`UNMIGRATED:   ${unmigratedCount}`);
      log(`MISMATCH:     ${mismatchCount}`);
      log("========================================================\n");
      return 0;
    }

    if (mode === "--cutover") {
      const walletId = args[1];
      if (!walletId) {
        error("Error: --cutover requires <walletId>");
        return 1;
      }
      const wallet = await prisma.billingWallet.findUnique({
        where: { id: walletId },
      });
      if (!wallet) {
        error(`Error: Wallet ${walletId} not found`);
        return 1;
      }
      log(
        `[GATE-03] Executing cutover transition for wallet ${walletId} (current version: ${wallet.version})...`,
      );
      const result = await cutoverService.cutoverWallet(
        walletId,
        wallet.version,
      );
      log(
        `[GATE-03] Cutover successful! Wallet ${result.walletId} is now at accountingUnitVersion: ${result.accountingUnitVersion}`,
      );
      return 0;
    }

    if (mode === "--rollback") {
      const walletId = args[1];
      if (!walletId) {
        error("Error: --rollback requires <walletId>");
        return 1;
      }
      const wallet = await prisma.billingWallet.findUnique({
        where: { id: walletId },
      });
      if (!wallet) {
        error(`Error: Wallet ${walletId} not found`);
        return 1;
      }
      log(
        `[GATE-03] Executing rollback transition for wallet ${walletId} (current version: ${wallet.version})...`,
      );
      const result = await cutoverService.rollbackWallet(
        walletId,
        wallet.version,
      );
      log(
        `[GATE-03] Rollback successful! Wallet ${result.walletId} is now reset to accountingUnitVersion: ${result.accountingUnitVersion}`,
      );
      return 0;
    }

    error(`Unknown mode: ${mode}`);
    log(
      "Valid modes: --audit, --reconcile, --backfill, --cutover <walletId>, --rollback <walletId>",
    );
    return 1;
  } finally {
    await prisma.$disconnect();
  }
}

function isDirectCliInvocation(): boolean {
  const invokedPath = process.argv[1];
  if (!invokedPath) {
    return false;
  }
  try {
    return (
      realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
}

if (isDirectCliInvocation()) {
  runBillingGate03CutoverCli(process.argv.slice(2))
    .then((exitCode) => {
      if (exitCode !== 0) {
        process.exit(exitCode);
      }
    })
    .catch((err) => {
      console.error("Fatal error:", err);
      process.exit(1);
    });
}
