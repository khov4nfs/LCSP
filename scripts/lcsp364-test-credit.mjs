import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

export const TEST_CREDIT = Object.freeze({
  userId: "2e723a25-b79c-4aac-a094-5771f3fbc590",
  email: "lcsp360-cheatshield-9e06c6e533@acceptance.invalid",
  reference: "LCSP-364",
  grantSource: "INTERNAL_TEST_GRANT",
  revokeSource: "INTERNAL_TEST_GRANT_REVERSAL",
  grantKey:
    "LCSP-364:test-credit:20261031:2e723a25-b79c-4aac-a094-5771f3fbc590:grant:1",
  revokeKey:
    "LCSP-364:test-credit:20261031:2e723a25-b79c-4aac-a094-5771f3fbc590:revoke:1",
  amount: 1_000_000n,
});

/**
 * Business purpose: Fund only the verified LCSP-364 test customer and reverse its unused grant.
 * Business rules:
 * - An active ADMIN authorizes the exact active CUSTOMER; no payment, webhook, policy or provider budget changes.
 * - The existing user lock, accounting kernel, idempotency validation and wallet projection remain authoritative.
 * - Reversal refuses held credits and unrelated positive credits rather than consuming another funding source.
 * Execution flow:
 * 1. Verify both account identities and acquire the existing billing user transaction lock.
 * 2. Append the fixed grant or unused-credit reversal through appendLedger, then append its audit atomically.
 * 3. Return sanitized before/after balances, grant consumption and remaining credits.
 * Failure cases:
 * - Wrong identity, non-admin actor, mixed funding, active holds or audit failure aborts without partial credit.
 * - Replaying either fixed key returns the original ledger record without a second grant or audit.
 * Side effects:
 * - Writes one ledger entry, its kernel-maintained projection and one audit; never creates a payment/order/webhook.
 */
export async function applyTestCredit({
  prisma,
  transactions,
  Kernel,
  actorId,
  action,
}) {
  if (!["grant", "revoke"].includes(action))
    throw new Error("Expected grant or revoke");
  const [user, actor] = await Promise.all([
    prisma.user.findUnique({ where: { id: TEST_CREDIT.userId } }),
    prisma.user.findUnique({ where: { id: actorId } }),
  ]);
  if (
    user?.email !== TEST_CREDIT.email ||
    user.role !== "CUSTOMER" ||
    user.accessStatus !== "ACTIVE"
  )
    throw new Error("Exact active test customer not verified");
  if (
    actor?.role !== "ADMIN" ||
    actor.accessStatus !== "ACTIVE" ||
    actor.id === user.id
  )
    throw new Error("Active ADMIN actor required");

  return transactions.runForUser(user.id, async (repos) => {
    const before = await repos.wallet.getOrCreateForUser(user.id);
    const entries = await repos.ledger.listForWallet(before.id);
    const grant = entries.find(
      (entry) => entry.idempotencyKey === TEST_CREDIT.grantKey,
    );
    const reversal = entries.find(
      (entry) => entry.idempotencyKey === TEST_CREDIT.revokeKey,
    );
    const existing = action === "grant" ? grant : reversal;
    if (action === "grant" && reversal)
      throw new Error("Test grant already closed");
    let used = 0n;
    if (grant) {
      if (
        grant.deltaCredits !== TEST_CREDIT.amount ||
        grant.source !== TEST_CREDIT.grantSource ||
        grant.referenceId !== TEST_CREDIT.reference ||
        grant.userId !== user.id
      )
        throw new Error("Grant identity mismatch");
      for (const entry of entries) {
        if (
          entry.createdAt < grant.createdAt ||
          entry.id === grant.id ||
          entry.id === reversal?.id
        )
          continue;
        if (entry.deltaCredits > 0n)
          throw new Error("Unrelated positive funding requires reconciliation");
        used -= entry.deltaCredits;
      }
    }
    if (action === "revoke" && !grant)
      throw new Error("No test grant to reverse");
    if (action === "revoke" && before.reservedCredits !== 0n)
      throw new Error("Test credits still held");
    const unused = TEST_CREDIT.amount > used ? TEST_CREDIT.amount - used : 0n;
    const delta =
      action === "grant"
        ? TEST_CREDIT.amount
        : (existing?.deltaCredits ?? -unused);
    if (action === "revoke" && !existing && unused === 0n)
      throw new Error("No unused grant remains");
    // Reuse the already-locked billing transaction; appendLedger still owns all money/projection checks.
    const accounting = new Kernel({
      runForUser: (_id, operation) => operation(repos),
    });
    const entry = await accounting.appendLedger({
      userId: user.id,
      walletId: before.id,
      deltaCredits: delta,
      idempotencyKey:
        action === "grant" ? TEST_CREDIT.grantKey : TEST_CREDIT.revokeKey,
      source:
        action === "grant" ? TEST_CREDIT.grantSource : TEST_CREDIT.revokeSource,
      referenceId: TEST_CREDIT.reference,
    });
    const after = await repos.wallet.findForUser(user.id);
    const receipt = {
      reference: TEST_CREDIT.reference,
      action,
      replay: Boolean(existing),
      testAccountHash: createHash("sha256")
        .update(user.id)
        .digest("hex")
        .slice(0, 16),
      actorVerifiedAdmin: true,
      ledgerEntryId: entry.id,
      source: entry.source,
      idempotencyKey: entry.idempotencyKey,
      deltaCredits: entry.deltaCredits.toString(),
      before: {
        available: before.availableCredits.toString(),
        reserved: before.reservedCredits.toString(),
        version: before.version,
      },
      after: {
        available: after.availableCredits.toString(),
        reserved: after.reservedCredits.toString(),
        version: after.version,
      },
      grantCredits: TEST_CREDIT.amount.toString(),
      usedCredits: used.toString(),
      remainingTestCredits: (action === "revoke" || reversal
        ? 0n
        : unused
      ).toString(),
    };
    if (!existing)
      await repos.audit.append({
        eventType: entry.source,
        actorId: actor.id,
        correlationId: entry.idempotencyKey,
        resourceId: before.id,
        payload: receipt,
      });
    return receipt;
  });
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  const require = createRequire(
    new URL("../apps/api/package.json", import.meta.url),
  );
  const { PrismaService, BillingAccountingKernel, PrismaBillingTransaction } =
    await import(require.resolve("@lcsp/api/operations"));
  const prisma = new PrismaService();
  try {
    console.log(
      JSON.stringify(
        await applyTestCredit({
          prisma,
          transactions: new PrismaBillingTransaction(prisma),
          Kernel: BillingAccountingKernel,
          actorId: process.env.LCSP_TEST_GRANT_ADMIN_ID,
          action: process.argv[2],
        }),
      ),
    );
  } finally {
    await prisma.$disconnect();
  }
}
