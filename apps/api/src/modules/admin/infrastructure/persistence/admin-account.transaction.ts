import { HttpStatus } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import {
  ADMIN_ACCOUNT_ERRORS,
  AUTH_ERROR_CODES,
  AUTH_USER_ROLES,
  USER_ACCESS_STATUSES,
  type AdminAccountOperation,
} from "@lcsp/contracts/auth";
import type { RbacRequestContext } from "../../../../platform/rbac/interfaces/rbac-request.interface.js";
import type { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { AUTH_RECORD_TYPES } from "../../../auth/infrastructure/persistence/auth-record.persistence.js";
import { isNumber, isRecord } from "../../../../common/utils/index.js";

export type AdminActor = RbacRequestContext & {
  correlationId: string;
  idempotencyKey: string;
};

/**
 * Acquires a PostgreSQL transaction-scoped advisory lock for administrative account mutations.
 * Enforces a 3-second lock timeout to fail fast on deadlocks.
 */
export async function lockAccountLifecycle(
  transactionClient: Prisma.TransactionClient,
): Promise<void> {
  await transactionClient.$executeRaw`SET LOCAL lock_timeout = '3000ms'`;
  await transactionClient.$executeRaw`SELECT pg_advisory_xact_lock(299, 1)`;
}

/**
 * Runs an administrative database transaction wrapped with advisory locks and error mapping.
 * Catches Postgres concurrency errors (P2034, P2028, 55P03 lock_not_available, 40P01 deadlock_detected)
 * and maps them into an HTTP 409 Conflict problem exception.
 */
export async function accountTransaction<T>(
  prisma: PrismaService,
  correlationId: string,
  transactionCallback: (
    transactionClient: Prisma.TransactionClient,
  ) => Promise<T>,
): Promise<T> {
  try {
    return await prisma.$transaction(
      async (transactionClient) => {
        await lockAccountLifecycle(transactionClient);
        return transactionCallback(transactionClient);
      },
      {
        isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted,
        timeout: 15000,
        maxWait: 5000,
      },
    );
  } catch (error) {
    const errorDetails = error as { code?: string; meta?: { code?: string } };
    if (
      errorDetails.code === "P2034" ||
      errorDetails.code === "P2028" ||
      errorDetails.code === "55P03" ||
      errorDetails.code === "40P01" ||
      errorDetails.meta?.code === "55P03" ||
      errorDetails.meta?.code === "40P01"
    ) {
      throw problemException(
        ADMIN_ACCOUNT_ERRORS.concurrentChange,
        correlationId,
        {
          status: HttpStatus.CONFLICT,
        },
      );
    }
    throw error;
  }
}

/**
 * Re-verifies inside the active transaction that the acting administrator:
 * 1. Has role = ADMIN.
 * 2. Has accessStatus = ACTIVE.
 * 3. Has emailVerified = TRUE.
 * 4. Has an active, non-revoked session matching the user's current accessVersion.
 */
export async function assertCurrentAdmin(
  transactionClient: Prisma.TransactionClient,
  actor: AdminActor,
): Promise<void> {
  const user = await transactionClient.user.findUnique({
    where: { id: actor.userId },
    select: {
      role: true,
      accessStatus: true,
      emailVerified: true,
      accessVersion: true,
    },
  });
  if (
    !user ||
    user.role !== AUTH_USER_ROLES.admin ||
    user.accessStatus !== USER_ACCESS_STATUSES.active ||
    !user.emailVerified
  ) {
    throw problemException(AUTH_ERROR_CODES.rbacDenied, actor.correlationId, {
      status: HttpStatus.FORBIDDEN,
    });
  }
  const session = await transactionClient.authRecord.findFirst({
    where: {
      id: actor.sessionId,
      userId: actor.userId,
      type: AUTH_RECORD_TYPES.session,
      revokedAt: null,
      expiresAt: { gt: new Date() },
    },
    select: { metadata: true },
  });
  const metadata = session?.metadata;
  const sessionVersion =
    isRecord(metadata) && isNumber(metadata.accessVersion)
      ? metadata.accessVersion
      : 0;
  if (!session || sessionVersion !== user.accessVersion) {
    throw problemException(
      AUTH_ERROR_CODES.sessionInvalid,
      actor.correlationId,
      { status: HttpStatus.UNAUTHORIZED },
    );
  }
}

/**
 * Creates the legacy SHA-256 hash format for backward compatibility with persisted receipts.
 */
export function legacyRequestHash(
  operation: AdminAccountOperation,
  input: unknown,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ operation, input }))
    .digest("hex");
}

/**
 * Creates a deterministic SHA-256 hash of the administrative operation name and canonical JSON payload (sorted keys).
 */
export function canonicalRequestHash(
  operation: AdminAccountOperation,
  input: unknown,
): string {
  const sortedPayloadString = JSON.stringify(
    input,
    Object.keys(input || {}).sort(),
  );
  return createHash("sha256")
    .update(`${operation}:${sortedPayloadString}`)
    .digest("hex");
}

/**
 * Returns canonical hash for idempotency receipts.
 */
export function requestHash(
  operation: AdminAccountOperation,
  input: unknown,
): string {
  return canonicalRequestHash(operation, input);
}

/**
 * Checks for a previously processed idempotent command receipt.
 * If the idempotency key matches with identical payload hash (or legacy hash format), returns the cached resource ID.
 * If the payload or operation differs, throws a 409 Conflict exception.
 */
export async function replay(
  transactionClient: Prisma.TransactionClient,
  actor: AdminActor,
  operation: AdminAccountOperation,
  payloadHash: string,
  legacyHash?: string,
): Promise<{ resourceId: string } | null> {
  const existingReceipt =
    await transactionClient.adminAccountCommandReceipt.findUnique({
      where: {
        actorId_idempotencyKey: {
          actorId: actor.userId,
          idempotencyKey: actor.idempotencyKey,
        },
      },
    });
  if (!existingReceipt) return null;
  const isHashMatch =
    existingReceipt.requestHash === payloadHash ||
    (Boolean(legacyHash) && existingReceipt.requestHash === legacyHash);
  if (existingReceipt.operation !== operation || !isHashMatch) {
    throw problemException(
      ADMIN_ACCOUNT_ERRORS.idempotencyConflict,
      actor.correlationId,
      {
        status: HttpStatus.CONFLICT,
      },
    );
  }
  return { resourceId: existingReceipt.resourceId };
}

/**
 * Saves an execution receipt for an idempotent administrative mutation.
 */
export async function receipt(
  transactionClient: Prisma.TransactionClient,
  actor: AdminActor,
  operation: AdminAccountOperation,
  payloadHash: string,
  resourceId: string,
): Promise<void> {
  try {
    await transactionClient.adminAccountCommandReceipt.create({
      data: {
        id: randomUUID(),
        actorId: actor.userId,
        idempotencyKey: actor.idempotencyKey,
        operation,
        requestHash: payloadHash,
        resourceId,
      },
    });
  } catch (error) {
    const prismaError = error as { code?: string };
    if (prismaError.code === "P2002") {
      throw problemException(
        ADMIN_ACCOUNT_ERRORS.idempotencyConflict,
        actor.correlationId,
        {
          status: HttpStatus.CONFLICT,
        },
      );
    }
    throw error;
  }
}
