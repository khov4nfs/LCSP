import type { Prisma } from "@prisma/client";

/** Shared by provisioning and lifecycle commands. ReadCommitted re-reads after lock acquisition. */
export async function lockAccountLifecycle(
  tx: Prisma.TransactionClient,
): Promise<void> {
  await tx.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(299, 1)`;
}
