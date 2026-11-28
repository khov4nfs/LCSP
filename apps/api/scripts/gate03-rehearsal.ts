/**
 * GATE-03 Operational Rehearsal Script
 *
 * Executes a full end-to-end operational dry-run on 127.0.0.1:5432/lcsp_local:
 * 1. Seed mock users, wallets, and ledger entries (>500 entries, active reservation, legacy mismatch).
 * 2. Audit (initial) -> Backfill (batch 1 + batch 2) -> Idempotency Backfill -> Audit (post-backfill).
 * 3. Cutover attempts on invalid wallets (reservation hold & legacy mismatch) -> verify rejection.
 * 4. Cutover on valid wallet -> Top-up post-cutover -> Rollback eligible wallet.
 * 5. Capture full before/after states, ledger counts, and transaction versions at each phase.
 * 6. Clean up drill data only.
 */

import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { resolveDatasourceUrl } from "../prisma.config.js";
import {
  prismaConnectionConfig,
  PrismaService,
} from "../src/infrastructure/prisma/prisma.service.js";
import { PrismaBillingTransaction } from "../src/modules/billing/infrastructure/persistence/prisma-billing-transaction.js";
import { BillingAccountingKernel } from "../src/modules/billing/application/shared/billing-accounting.kernel.js";
import {
  BillingCutoverService,
  WALLET_CUTOVER_STATUSES,
} from "../src/modules/billing/application/shared/billing-cutover.service.js";
import {
  assertPermittedCutoverDatasource,
  runBillingGate03CutoverCli,
  type BillingGate03PrismaClient,
} from "./billing-gate03-cutover.js";

const PREFIX = "gate03_drill_";

interface DrillSummary {
  step: string;
  timestamp: string;
  exitCode?: number;
  details: Record<string, unknown>;
}

async function main(): Promise<void> {
  const targetUrl = resolveDatasourceUrl();
  assertPermittedCutoverDatasource(targetUrl);
  console.log(
    `[REHEARSAL] Verified target database: 127.0.0.1:5432/lcsp_local`,
  );

  const prisma = new PrismaClient({
    adapter: new PrismaPg(
      prismaConnectionConfig(targetUrl, process.env.PGOPTIONS ?? ""),
    ),
  });

  const txPort = new PrismaBillingTransaction(
    prisma as unknown as PrismaService,
  );
  const cutoverService = new BillingCutoverService(
    txPort,
    undefined,
    prisma as unknown as PrismaService,
  );
  const accountingKernel = new BillingAccountingKernel(txPort);

  const stepsLog: DrillSummary[] = [];

  function recordStep(
    step: string,
    details: Record<string, unknown>,
    exitCode = 0,
  ) {
    const entry: DrillSummary = {
      step,
      timestamp: new Date().toISOString(),
      exitCode,
      details,
    };
    stepsLog.push(entry);
    console.log(`\n=================== [STEP: ${step}] ===================`);
    console.log(
      JSON.stringify(
        details,
        (_k: string, v: unknown): unknown =>
          typeof v === "bigint" ? `${v}n` : v,
        2,
      ),
    );
  }

  try {
    // -------------------------------------------------------------
    // STEP 0: Clean any previous drill data just in case
    // -------------------------------------------------------------
    await cleanupDrillData(prisma);

    // -------------------------------------------------------------
    // STEP 1: SEED DRILL DATA
    // -------------------------------------------------------------
    const userValidId = `${PREFIX}usr_valid`;
    const walletValidId = `${PREFIX}wal_valid`;

    const userReservedId = `${PREFIX}usr_reserved`;
    const walletReservedId = `${PREFIX}wal_reserved`;

    const userMismatchedId = `${PREFIX}usr_mismatched`;
    const walletMismatchedId = `${PREFIX}wal_mismatched`;

    // 1.1 Create 3 Users
    await prisma.user.createMany({
      data: [
        {
          id: userValidId,
          email: `${userValidId}@example.com`,
          passwordHash: "hash_drill_valid",
          emailVerified: true,
          failedLoginCount: 0,
        },
        {
          id: userReservedId,
          email: `${userReservedId}@example.com`,
          passwordHash: "hash_drill_reserved",
          emailVerified: true,
          failedLoginCount: 0,
        },
        {
          id: userMismatchedId,
          email: `${userMismatchedId}@example.com`,
          passwordHash: "hash_drill_mismatched",
          emailVerified: true,
          failedLoginCount: 0,
        },
      ],
    });

    // 1.2 Create 3 BillingWallets
    // Wallet 1: Valid, 600 entries * 10n credits = 6,000n credits, unmigrated (deltaMicrocredits = 0)
    // Wallet 2: Active reservation, 10 entries * 10n = 100n total. available = 80n, reserved = 20n
    // Wallet 3: Deliberately corrupted availableCredits = 999n (ledger sum is 100n)
    await prisma.billingWallet.createMany({
      data: [
        {
          id: walletValidId,
          userId: userValidId,
          availableCredits: 6000n,
          reservedCredits: 0n,
          balanceMicrocredits: 0n,
          accountingUnitVersion: 1,
          version: 0,
        },
        {
          id: walletReservedId,
          userId: userReservedId,
          availableCredits: 80n,
          reservedCredits: 20n,
          balanceMicrocredits: 0n,
          accountingUnitVersion: 1,
          version: 0,
        },
        {
          id: walletMismatchedId,
          userId: userMismatchedId,
          availableCredits: 999n, // Mismatch!
          reservedCredits: 0n,
          balanceMicrocredits: 0n,
          accountingUnitVersion: 1,
          version: 0,
        },
      ],
    });

    // 1.3 Create Reservation on Wallet 2
    await prisma.billingReservation.create({
      data: {
        id: `${PREFIX}res_active_1`,
        userId: userReservedId,
        walletId: walletReservedId,
        amountCredits: 20n,
        remainingCredits: 20n,
        status: "RESERVED",
      },
    });

    // 1.4 Seed 600 unmigrated entries on Wallet 1 (exceeds 500 batch size)
    const validEntries = Array.from({ length: 600 }, (_, i) => ({
      id: `${PREFIX}entry_v_${i + 1}`,
      userId: userValidId,
      walletId: walletValidId,
      deltaCredits: 10n,
      deltaMicrocredits: null, // Historical unmigrated
      accountingUnitVersion: 1,
      idempotencyKey: `${PREFIX}ik_v_${i + 1}`,
      source: "BILLING_ORDER_CREDIT",
    }));
    await prisma.creditLedgerEntry.createMany({ data: validEntries });

    // 1.5 Seed 10 unmigrated entries on Wallet 2
    const reservedEntries = Array.from({ length: 10 }, (_, i) => ({
      id: `${PREFIX}entry_r_${i + 1}`,
      userId: userReservedId,
      walletId: walletReservedId,
      deltaCredits: 10n,
      deltaMicrocredits: null,
      accountingUnitVersion: 1,
      idempotencyKey: `${PREFIX}ik_r_${i + 1}`,
      source: "BILLING_ORDER_CREDIT",
    }));
    await prisma.creditLedgerEntry.createMany({ data: reservedEntries });

    // 1.6 Seed 10 unmigrated entries on Wallet 3
    const mismatchedEntries = Array.from({ length: 10 }, (_, i) => ({
      id: `${PREFIX}entry_m_${i + 1}`,
      userId: userMismatchedId,
      walletId: walletMismatchedId,
      deltaCredits: 10n,
      deltaMicrocredits: null,
      accountingUnitVersion: 1,
      idempotencyKey: `${PREFIX}ik_m_${i + 1}`,
      source: "BILLING_ORDER_CREDIT",
    }));
    await prisma.creditLedgerEntry.createMany({ data: mismatchedEntries });

    const totalUnmigratedBefore = await prisma.creditLedgerEntry.count({
      where: { deltaMicrocredits: null },
    });

    recordStep("1_SEED_COMPLETED", {
      totalWalletsSeeded: 3,
      totalLedgerEntriesSeeded: 620,
      totalUnmigratedRows: totalUnmigratedBefore,
      walletValid: {
        id: walletValidId,
        available: "6000n",
        reserved: "0n",
        entries: 600,
      },
      walletReserved: {
        id: walletReservedId,
        available: "80n",
        reserved: "20n",
        entries: 10,
        reservations: 1,
      },
      walletMismatched: {
        id: walletMismatchedId,
        available: "999n",
        reserved: "0n",
        entries: 10,
        expectedLedgerSum: "100n",
      },
    });

    // -------------------------------------------------------------
    // STEP 2: INITIAL AUDIT (--audit)
    // -------------------------------------------------------------
    const initialReports = [
      await cutoverService.reconcileWallet(walletValidId),
      await cutoverService.reconcileWallet(walletReservedId),
      await cutoverService.reconcileWallet(walletMismatchedId),
    ];

    recordStep("2_INITIAL_AUDIT", {
      walletValidStatus: initialReports[0].status,
      walletReservedStatus: initialReports[1].status,
      walletMismatchedStatus: initialReports[2].status,
      allUnmigrated: initialReports.every(
        (r) => r.status === WALLET_CUTOVER_STATUSES.UNMIGRATED,
      ),
    });

    // -------------------------------------------------------------
    // STEP 3: RUN BACKFILL (--backfill)
    // -------------------------------------------------------------
    const cliLogs: string[] = [];
    const cliErrors: string[] = [];
    const backfillExitCode = await runBillingGate03CutoverCli(["--backfill"], {
      resolveDatasourceUrl: () => targetUrl,
      createPrismaClient: () => prisma as unknown as BillingGate03PrismaClient,
      log: (m) => cliLogs.push(m),
      warn: (m) => cliLogs.push(m),
      error: (m) => cliErrors.push(m),
    });

    const unmigratedAfterBackfill = await prisma.creditLedgerEntry.count({
      where: { deltaMicrocredits: null },
    });

    recordStep(
      "3_BACKFILL_EXECUTION",
      {
        backfillExitCode,
        unmigratedRemaining: unmigratedAfterBackfill,
        cliOutput: cliLogs.join("\n"),
      },
      backfillExitCode,
    );

    if (backfillExitCode !== 0 || unmigratedAfterBackfill !== 0) {
      throw new Error(
        `Backfill failed with exitCode ${backfillExitCode}, remaining: ${unmigratedAfterBackfill}`,
      );
    }

    // -------------------------------------------------------------
    // STEP 4: RE-RUN BACKFILL (IDEMPOTENCY VERIFICATION)
    // -------------------------------------------------------------
    const secondLogs: string[] = [];
    const secondExitCode = await runBillingGate03CutoverCli(["--backfill"], {
      resolveDatasourceUrl: () => targetUrl,
      createPrismaClient: () => prisma as unknown as BillingGate03PrismaClient,
      log: (m) => secondLogs.push(m),
      warn: (m) => secondLogs.push(m),
      error: (m) => secondLogs.push(m),
    });

    const unmigratedAfterSecond = await prisma.creditLedgerEntry.count({
      where: { deltaMicrocredits: null },
    });

    recordStep(
      "4_BACKFILL_IDEMPOTENCY_VERIFICATION",
      {
        secondExitCode,
        unmigratedRemaining: unmigratedAfterSecond,
        cliOutput: secondLogs.join("\n"),
        isStrictNoOp:
          unmigratedAfterSecond === 0 &&
          secondLogs.some((l) => l.includes("Remaining: 0")),
      },
      secondExitCode,
    );

    // Synchronize balanceMicrocredits projections for wallets
    await cutoverService.syncWalletMicrocreditProjection(walletValidId);
    await cutoverService.syncWalletMicrocreditProjection(walletReservedId);
    await cutoverService.syncWalletMicrocreditProjection(walletMismatchedId);

    // -------------------------------------------------------------
    // STEP 5: POST-BACKFILL AUDIT (--audit)
    // -------------------------------------------------------------
    const postAuditReports = [
      await cutoverService.reconcileWallet(walletValidId),
      await cutoverService.reconcileWallet(walletReservedId),
      await cutoverService.reconcileWallet(walletMismatchedId),
    ];

    recordStep("5_POST_BACKFILL_AUDIT", {
      walletValid: {
        status: postAuditReports[0].status,
        ledgerMicrocredits: postAuditReports[0].ledgerMicrocredits,
        walletMicrocredits: postAuditReports[0].walletBalanceMicrocredits,
        legacyAvailable: postAuditReports[0].legacyAvailableCredits,
        ledgerLegacy: postAuditReports[0].ledgerLegacyCredits,
      },
      walletReserved: {
        status: postAuditReports[1].status,
        ledgerMicrocredits: postAuditReports[1].ledgerMicrocredits,
        walletMicrocredits: postAuditReports[1].walletBalanceMicrocredits,
      },
      walletMismatched: {
        status: postAuditReports[2].status,
        ledgerMicrocredits: postAuditReports[2].ledgerMicrocredits,
        walletMicrocredits: postAuditReports[2].walletBalanceMicrocredits,
        legacyAvailable: postAuditReports[2].legacyAvailableCredits,
        ledgerLegacy: postAuditReports[2].ledgerLegacyCredits,
        legacyDiff: postAuditReports[2].legacyDifferenceCredits,
      },
    });

    if (postAuditReports[0].status !== WALLET_CUTOVER_STATUSES.MATCH) {
      throw new Error(
        `Expected walletValid to be MATCH, got ${postAuditReports[0].status}`,
      );
    }
    if (postAuditReports[2].status !== WALLET_CUTOVER_STATUSES.MISMATCH) {
      throw new Error(
        `Expected walletMismatched to be MISMATCH, got ${postAuditReports[2].status}`,
      );
    }

    // -------------------------------------------------------------
    // STEP 6: CUTOVER ATTEMPTS ON INVALID WALLETS (MUST FAIL)
    // -------------------------------------------------------------
    // 6.1 Wallet 2 has active reservation -> must reject
    let wallet2Rejected = false;
    let wallet2ErrorMessage = "";
    try {
      const w2 = await prisma.billingWallet.findUniqueOrThrow({
        where: { id: walletReservedId },
      });
      await cutoverService.cutoverWallet(walletReservedId, w2.version);
    } catch (err: unknown) {
      wallet2Rejected = true;
      wallet2ErrorMessage = (err as Error).message;
    }

    const w2After = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: walletReservedId },
    });

    // 6.2 Wallet 3 has legacy parity mismatch -> must reject
    let wallet3Rejected = false;
    let wallet3ErrorMessage = "";
    try {
      const w3 = await prisma.billingWallet.findUniqueOrThrow({
        where: { id: walletMismatchedId },
      });
      await cutoverService.cutoverWallet(walletMismatchedId, w3.version);
    } catch (err: unknown) {
      wallet3Rejected = true;
      wallet3ErrorMessage = (err as Error).message;
    }

    const w3After = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: walletMismatchedId },
    });

    recordStep("6_CUTOVER_SAFETY_REJECTIONS", {
      walletReservedRejected: wallet2Rejected,
      walletReservedError: wallet2ErrorMessage,
      walletReservedAccountingUnitVersion: w2After.accountingUnitVersion,
      walletReservedVersion: w2After.version,
      walletMismatchedRejected: wallet3Rejected,
      walletMismatchedError: wallet3ErrorMessage,
      walletMismatchedAccountingUnitVersion: w3After.accountingUnitVersion,
      walletMismatchedVersion: w3After.version,
    });

    if (!wallet2Rejected || w2After.accountingUnitVersion !== 1) {
      throw new Error("Wallet with active reservation was not rejected!");
    }
    if (!wallet3Rejected || w3After.accountingUnitVersion !== 1) {
      throw new Error("Wallet with legacy parity mismatch was not rejected!");
    }

    // -------------------------------------------------------------
    // STEP 7: CUTOVER ON VALID WALLET (--cutover)
    // -------------------------------------------------------------
    const w1Before = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: walletValidId },
    });
    const cutoverResult = await cutoverService.cutoverWallet(
      walletValidId,
      w1Before.version,
    );
    const w1PostCutover = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: walletValidId },
    });

    recordStep("7_VALID_WALLET_CUTOVER_SUCCESS", {
      cutoverResult,
      walletBefore: {
        version: w1Before.version,
        accountingUnitVersion: w1Before.accountingUnitVersion,
      },
      walletAfter: {
        version: w1PostCutover.version,
        accountingUnitVersion: w1PostCutover.accountingUnitVersion,
        availableCredits: w1PostCutover.availableCredits,
        balanceMicrocredits: w1PostCutover.balanceMicrocredits,
      },
    });

    if (w1PostCutover.accountingUnitVersion !== 2) {
      throw new Error(
        `Expected accountingUnitVersion = 2 after cutover, got ${w1PostCutover.accountingUnitVersion}`,
      );
    }

    // -------------------------------------------------------------
    // STEP 8: TOP-UP POST-CUTOVER (RETAINS accountingUnitVersion = 2)
    // -------------------------------------------------------------
    const drillOrderId = `${PREFIX}order_topup_post`;
    await prisma.billingOrder.create({
      data: {
        id: drillOrderId,
        userId: userValidId,
        paymentCode: `${PREFIX}PAY_CODE_1`,
        idempotencyKey: `${PREFIX}ik_order_topup_post`,
        status: "CREDITED",
        amountMinorUnits: 500_000n,
        creditUnits: 50n,
      },
    });

    await txPort.runForUser(userValidId, async (repos) => {
      await accountingKernel.creditOrderInTransaction(repos, {
        userId: userValidId,
        walletId: walletValidId,
        orderId: drillOrderId,
        creditUnits: 50n,
      });
    });

    const w1PostTopup = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: walletValidId },
    });
    const topupEntry = await prisma.creditLedgerEntry.findUniqueOrThrow({
      where: {
        idempotencyKey: `billing-order:${PREFIX}order_topup_post:credit`,
      },
    });

    recordStep("8_POST_CUTOVER_TOPUP_VERIFICATION", {
      orderCreditUnits: "50n",
      ledgerEntry: {
        id: topupEntry.id,
        deltaCredits: topupEntry.deltaCredits,
        deltaMicrocredits: topupEntry.deltaMicrocredits,
        accountingUnitVersion: topupEntry.accountingUnitVersion,
      },
      walletAfterTopup: {
        availableCredits: w1PostTopup.availableCredits,
        balanceMicrocredits: w1PostTopup.balanceMicrocredits,
        accountingUnitVersion: w1PostTopup.accountingUnitVersion,
        version: w1PostTopup.version,
      },
      retainsVersion2: w1PostTopup.accountingUnitVersion === 2,
    });

    if (
      w1PostTopup.accountingUnitVersion !== 2 ||
      w1PostTopup.availableCredits !== 6050n
    ) {
      throw new Error(
        `Top-up failed to preserve version 2: ${JSON.stringify(w1PostTopup)}`,
      );
    }

    // -------------------------------------------------------------
    // STEP 9: SAFE ROLLBACK (--rollback)
    // -------------------------------------------------------------
    const rollbackResult = await cutoverService.rollbackWallet(
      walletValidId,
      w1PostTopup.version,
    );
    const w1PostRollback = await prisma.billingWallet.findUniqueOrThrow({
      where: { id: walletValidId },
    });

    recordStep("9_SAFE_ROLLBACK_VERIFICATION", {
      rollbackResult,
      walletAfterRollback: {
        availableCredits: w1PostRollback.availableCredits,
        balanceMicrocredits: w1PostRollback.balanceMicrocredits,
        accountingUnitVersion: w1PostRollback.accountingUnitVersion,
        version: w1PostRollback.version,
      },
      revertsToVersion1: w1PostRollback.accountingUnitVersion === 1,
    });

    if (
      w1PostRollback.accountingUnitVersion !== 1 ||
      w1PostRollback.availableCredits !== 6050n
    ) {
      throw new Error(
        `Rollback failed to revert safely to version 1: ${JSON.stringify(w1PostRollback)}`,
      );
    }

    // -------------------------------------------------------------
    // STEP 10: CLEANUP DRILL DATA ONLY
    // -------------------------------------------------------------
    const cleanupReport = await cleanupDrillData(prisma);
    recordStep("10_CLEANUP_DRILL_DATA", cleanupReport);

    // -------------------------------------------------------------
    // STEP 11: FINAL RECONCILIATION AUDIT (EMPTY DRILL DB)
    // -------------------------------------------------------------
    const finalAuditLogs: string[] = [];
    const finalAuditExitCode = await runBillingGate03CutoverCli(["--audit"], {
      resolveDatasourceUrl: () => targetUrl,
      createPrismaClient: () => prisma as unknown as BillingGate03PrismaClient,
      log: (m) => finalAuditLogs.push(m),
      warn: (m) => finalAuditLogs.push(m),
      error: (m) => finalAuditLogs.push(m),
    });

    recordStep(
      "11_FINAL_CLEAN_AUDIT",
      {
        finalAuditExitCode,
        output: finalAuditLogs.join("\n"),
      },
      finalAuditExitCode,
    );

    console.log("\n=======================================================");
    console.log("       GATE-03 OPERATIONAL REHEARSAL SUCCESSFUL       ");
    console.log("=======================================================\n");
  } finally {
    await prisma.$disconnect();
  }
}

async function cleanupDrillData(
  prisma: PrismaClient,
): Promise<Record<string, number>> {
  const deletedReservations = await prisma.billingReservation.deleteMany({
    where: {
      OR: [
        { id: { startsWith: PREFIX } },
        { walletId: { startsWith: PREFIX } },
        { userId: { startsWith: PREFIX } },
      ],
    },
  });
  const deletedLedger = await prisma.creditLedgerEntry.deleteMany({
    where: {
      OR: [
        { id: { startsWith: PREFIX } },
        { walletId: { startsWith: PREFIX } },
        { userId: { startsWith: PREFIX } },
      ],
    },
  });
  const deletedOrders = await prisma.billingOrder.deleteMany({
    where: {
      OR: [{ id: { startsWith: PREFIX } }, { userId: { startsWith: PREFIX } }],
    },
  });
  const deletedWallets = await prisma.billingWallet.deleteMany({
    where: {
      OR: [{ id: { startsWith: PREFIX } }, { userId: { startsWith: PREFIX } }],
    },
  });
  const deletedUsers = await prisma.user.deleteMany({
    where: { id: { startsWith: PREFIX } },
  });
  return {
    deletedReservations: deletedReservations.count,
    deletedLedgerEntries: deletedLedger.count,
    deletedOrders: deletedOrders.count,
    deletedWallets: deletedWallets.count,
    deletedUsers: deletedUsers.count,
  };
}

main().catch((err) => {
  console.error("FATAL REHEARSAL ERROR:", err);
  process.exit(1);
});
