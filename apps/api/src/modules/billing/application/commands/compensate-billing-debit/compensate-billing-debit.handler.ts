/**
 * Rationale ("Why"): G-07 Transaction Compensation & Debit Linking handler.
 * Mechanism ("How"): Dispatched by CommandBus from BillingAdminController, enforces admin authority,
 * locks BillingWallet FOR UPDATE first to serialize concurrent operations, checks canonical payload fingerprint inside the lock boundary,
 * validates cumulative ceiling, and commits 4 records atomically. Catches unique constraint collisions (P2002) cleanly.
 * Replay returns the exact historical snapshot of the original transaction, not current wallet balance.
 * Invariants & Constraints: Atomic commit across Ledger, Wallet, Audit, Outbox; strict row serialization; full payload fingerprinting.
 */

import { createHash, randomUUID } from "node:crypto";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { HttpStatus, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  BILLING_ACTIONS,
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ERROR_CODES,
  BILLING_ROLLOUT_MODES,
  CREDIT_LEDGER_SOURCES,
  MODEL_USAGE_DEBIT_MODES,
  compensateBillingDebitResponseSchema,
  type CompensateBillingDebitResponse,
} from "@lcsp/contracts/billing";
import {
  OUTBOX_AGGREGATE_TYPES,
  OUTBOX_STATUSES,
} from "@lcsp/contracts/outbox";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { CompensateBillingDebitCommand } from "./compensate-billing-debit.command.js";

/**
 * Business purpose: Compute canonical SHA-256 fingerprint for business compensation payload.
 *
 * Business rules:
 * - Fingerprint must cover amountMicrocredits, originalLedgerEntryId, and trimmed reason.
 * - Any divergence in amount, debit identity, or reason creates a distinct hash.
 * - Pure determinism: identical payload fields always yield identical hash.
 *
 * Execution flow:
 * 1. Normalize and trim payload fields.
 * 2. Format canonical JSON representation.
 * 3. Compute SHA-256 hex digest.
 * 4. Return resulting hex string.
 *
 * Failure cases:
 * - Throws if JSON serialization or crypto digest computation fails.
 *
 * Side effects:
 * - Read-only and pure; no persistence or state mutations.
 */
function computeCompensationFingerprint(input: {
  originalLedgerEntryId: string;
  amountMicrocredits: string;
  reason: string;
}): string {
  const canonical = JSON.stringify({
    amountMicrocredits: input.amountMicrocredits.trim(),
    originalLedgerEntryId: input.originalLedgerEntryId.trim(),
    reason: input.reason.trim(),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

@Injectable()
@CommandHandler(CompensateBillingDebitCommand)
export class CompensateBillingDebitHandler implements ICommandHandler<
  CompensateBillingDebitCommand,
  CompensateBillingDebitResponse
> {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Atomically compensate an eligible model usage debit up to its remaining uncompensated amount.
   *
   * Business rules:
   * - Caller must possess admin role and explicit compensation action permission ("billing:debit:compensate").
   * - Original debit must exist, have source MODEL_USAGE_DEBIT, and have valid admissionId + ModelUsageReceipt linkage.
   * - Linked admission must have debitMode ON and rolloutMode DEBIT_ENABLED, with matching walletId and userId.
   * - Cumulative compensation cannot exceed original debit amount under serialized row lock.
   * - Idempotent by idempotencyKey: identical payload fingerprint returns historical original snapshot; conflicting payload returns 409.
   * - Available credits projected from resulting microcredit balance, not added as integer division.
   * - Atomic 4-record commit: CreditLedgerEntry + BillingWallet + AuditEvent + OutboxMessage.
   *
   * Execution flow:
   * 1. Validate caller admin role and action permission.
   * 2. Validate requested amount, compute canonical payload fingerprint, and verify original debit eligibility.
   * 3. Begin database transaction and acquire pessimistic row lock (FOR UPDATE) on BillingWallet.
   * 4. Check idempotency within lock boundary: verify payload fingerprint parity; return original snapshot if identical, throw 409 if conflicting.
   * 5. Verify cumulative compensation ceiling against prior compensation entries.
   * 6. Atomically append CreditLedgerEntry, project BillingWallet, write AuditEvent, and emit OutboxMessage.
   * 7. Handle unique constraint collisions (P2002) gracefully, returning original snapshot if identical or 409 if conflicting.
   * 8. Return CompensateBillingDebitResponse conforming to shared contract schema.
   *
   * Failure cases:
   * - 403 if caller lacks admin role or compensation action authority.
   * - 404 if original debit does not exist or wallet is missing.
   * - 422 if debit is not eligible, amount is non-positive, or cumulative ceiling is breached.
   * - 409 if idempotency conflict occurs (different amount, debit, or reason under same key).
   *
   * Side effects:
   * - Appends CreditLedgerEntry, updates BillingWallet balance/version, writes AuditEvent and OutboxMessage.
   */
  async execute(
    command: CompensateBillingDebitCommand,
  ): Promise<CompensateBillingDebitResponse> {
    const { payload, rbacContext, correlationId } = command;

    // Rationale ("Why"): ADR-028 Line 173-174 requires explicit action permission; role alone never grants financial authority.
    // Mechanism ("How"): Verify caller holds AUTH_USER_ROLES.admin and BILLING_ACTIONS.compensation.
    // Invariants & Constraints: Goodwill credit authority ("billing:goodwill_credit") cannot execute compensation.
    if (
      rbacContext.role !== AUTH_USER_ROLES.admin ||
      !rbacContext.permissions?.includes(BILLING_ACTIONS.compensation)
    ) {
      throw problemException(AUTH_ERROR_CODES.rbacDenied, correlationId, {
        status: HttpStatus.FORBIDDEN,
      });
    }

    const requestedAmountMicrocredits = BigInt(payload.amountMicrocredits);
    if (requestedAmountMicrocredits <= 0n) {
      throw problemException(
        BILLING_ERROR_CODES.compensationAmountInvalid,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    // Compute canonical fingerprint covering entire business payload (amount, debitId, reason)
    const requestFingerprint = computeCompensationFingerprint({
      originalLedgerEntryId: payload.originalLedgerEntryId,
      amountMicrocredits: payload.amountMicrocredits,
      reason: payload.reason,
    });

    const debit = await this.prisma.creditLedgerEntry.findUnique({
      where: { id: payload.originalLedgerEntryId },
    });

    if (!debit) {
      throw problemException(BILLING_ERROR_CODES.debitNotFound, correlationId, {
        status: HttpStatus.NOT_FOUND,
      });
    }

    // Rationale ("Why"): Only legitimate historical model usage debits issued under valid financial authority are eligible.
    // Mechanism ("How"): Verify source is MODEL_USAGE_DEBIT, deltaMicrocredits is strictly negative, and admission exists.
    // Invariants & Constraints: Telemetry/shadow entries, top-ups, and orphaned records are strictly rejected.
    if (
      debit.source !== CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT ||
      (debit.deltaMicrocredits ?? 0n) >= 0n ||
      !debit.admissionId
    ) {
      throw problemException(
        BILLING_ERROR_CODES.debitNotEligible,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    // Verify linked BillableInvocationAdmission: must be debitMode ON and rolloutMode DEBIT_ENABLED
    const admission = await this.prisma.billableInvocationAdmission.findUnique({
      where: { id: debit.admissionId },
    });
    if (
      !admission ||
      admission.debitMode !== MODEL_USAGE_DEBIT_MODES.ON ||
      admission.rolloutMode !== BILLING_ROLLOUT_MODES.DEBIT_ENABLED ||
      admission.walletId !== debit.walletId ||
      admission.userId !== debit.userId
    ) {
      throw problemException(
        BILLING_ERROR_CODES.debitNotEligible,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    // Verify linked ModelUsageReceipt: must exist and debitedMicrocredits must match ledger debit amount
    const receipt = await this.prisma.modelUsageReceipt.findUnique({
      where: { admissionId: debit.admissionId },
    });
    const debitMicrocredits = -(debit.deltaMicrocredits ?? 0n);
    if (!receipt || receipt.debitedMicrocredits !== debitMicrocredits) {
      throw problemException(
        BILLING_ERROR_CODES.debitNotEligible,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    // Rationale ("Why"): ADR-028 Line 159 requires concurrency serialization and atomic 4-record commit under transaction.
    // Mechanism ("How"): Lock BillingWallet FOR UPDATE FIRST to serialize concurrent requests on the same aggregate,
    // evaluate idempotency inside the lock boundary, enforce cumulative limits, and commit ledger, wallet, audit, outbox.
    // Invariants & Constraints: Any midway failure rolls back all records; unique constraint collisions (P2002) are caught
    // and resolved cleanly to replay (200) or conflict (409) rather than leaking 500 errors.
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Step 1: Pessimistic row locking on BillingWallet FOR UPDATE FIRST.
        // Serializes concurrent requests on the same wallet so subsequent idempotency and balance queries
        // read committed state in strict sequence without race conditions.
        const [lockedWallet] = await tx.$queryRaw<
          Array<{
            id: string;
            balanceMicrocredits: bigint;
            availableCredits: bigint;
            version: number;
            accountingUnitVersion: number | null;
          }>
        >`
          SELECT id, "balanceMicrocredits", "availableCredits", version, "accountingUnitVersion"
          FROM "BillingWallet"
          WHERE id = ${debit.walletId}
          FOR UPDATE
        `;

        if (!lockedWallet) {
          throw problemException(BILLING_ERROR_CODES.notFound, correlationId, {
            status: HttpStatus.NOT_FOUND,
          });
        }

        // Step 2: Idempotency check inside lock boundary
        const existingWithIdempotency = await tx.creditLedgerEntry.findUnique({
          where: { idempotencyKey: payload.idempotencyKey },
        });

        if (existingWithIdempotency) {
          // Compare normalized canonical fingerprint (covers debitId, amount, AND reason)
          if (
            existingWithIdempotency.requestFingerprint !== requestFingerprint ||
            existingWithIdempotency.originalLedgerEntryId !== debit.id ||
            existingWithIdempotency.deltaMicrocredits !==
              requestedAmountMicrocredits
          ) {
            throw problemException(
              BILLING_ERROR_CODES.idempotencyConflict,
              correlationId,
              { status: HttpStatus.CONFLICT },
            );
          }

          // Return immutable historical snapshot of the original transaction
          return await this.buildReplaySnapshot(
            tx,
            existingWithIdempotency,
            debit,
            debitMicrocredits,
            requestedAmountMicrocredits,
            correlationId,
          );
        }

        // Step 3: Cumulative ceiling check
        const existingCompensations = await tx.creditLedgerEntry.findMany({
          where: {
            originalLedgerEntryId: debit.id,
            source: CREDIT_LEDGER_SOURCES.COMPENSATION,
          },
          select: { deltaMicrocredits: true },
        });
        const priorCompensatedMicrocredits = existingCompensations.reduce(
          (acc, curr) => acc + (curr.deltaMicrocredits ?? 0n),
          0n,
        );
        const newTotalCompensatedMicrocredits =
          priorCompensatedMicrocredits + requestedAmountMicrocredits;

        if (newTotalCompensatedMicrocredits > debitMicrocredits) {
          throw problemException(
            BILLING_ERROR_CODES.compensationLimitExceeded,
            correlationId,
            { status: HttpStatus.UNPROCESSABLE_ENTITY },
          );
        }

        // Step 4: Calculate wallet balance and project available credits
        const compensationEntryId = randomUUID();
        const now = new Date();
        const newBalanceMicrocredits =
          lockedWallet.balanceMicrocredits + requestedAmountMicrocredits;
        const newAvailableCredits =
          newBalanceMicrocredits > 0n
            ? newBalanceMicrocredits / 1_000_000n
            : 0n;
        const remainingUncompensated =
          debitMicrocredits - newTotalCompensatedMicrocredits;

        // 1. Append immutable CreditLedgerEntry with canonical requestFingerprint
        const compensationLedgerEntry = await tx.creditLedgerEntry.create({
          data: {
            id: compensationEntryId,
            userId: debit.userId,
            walletId: debit.walletId,
            originalLedgerEntryId: debit.id,
            idempotencyKey: payload.idempotencyKey,
            requestFingerprint,
            source: CREDIT_LEDGER_SOURCES.COMPENSATION,
            ledgerSource: CREDIT_LEDGER_SOURCES.COMPENSATION as any,
            deltaCredits: requestedAmountMicrocredits / 1_000_000n,
            deltaMicrocredits: requestedAmountMicrocredits,
            accountingUnitVersion: lockedWallet.accountingUnitVersion ?? 2,
            createdAt: now,
          },
        });

        // 2. Update BillingWallet balance and increment version
        const updatedWallet = await tx.billingWallet.update({
          where: { id: lockedWallet.id },
          data: {
            balanceMicrocredits: newBalanceMicrocredits,
            availableCredits: newAvailableCredits,
            version: { increment: 1 },
          },
        });

        // 3. Persist AuditEvent containing the complete original transaction snapshot
        await tx.auditEvent.create({
          data: {
            id: randomUUID(),
            eventType: BILLING_AUDIT_EVENT_TYPES.compensationIssued,
            actorId: rbacContext.userId ?? "system-admin",
            resourceId: compensationLedgerEntry.id,
            correlationId: correlationId ?? null,
            payload: {
              action: BILLING_ACTIONS.compensation,
              originalLedgerEntryId: debit.id,
              amountMicrocredits: requestedAmountMicrocredits.toString(),
              reason: payload.reason,
              walletId: debit.walletId,
              userId: debit.userId,
              previousBalanceMicrocredits:
                lockedWallet.balanceMicrocredits.toString(),
              newBalanceMicrocredits: newBalanceMicrocredits.toString(),
              walletVersion: updatedWallet.version,
              totalCompensatedMicrocredits:
                newTotalCompensatedMicrocredits.toString(),
              remainingUncompensatedMicrocredits:
                remainingUncompensated.toString(),
              compensatedAt: now.toISOString(),
              requestFingerprint,
            },
          },
        });

        // 4. Emit OutboxMessage within same transaction
        await tx.outboxMessage.create({
          data: {
            id: randomUUID(),
            aggregateType: OUTBOX_AGGREGATE_TYPES.billingWallet as any,
            aggregateId: lockedWallet.id,
            eventType: BILLING_AUDIT_EVENT_TYPES.compensationIssued,
            payload: {
              walletId: lockedWallet.id,
              userId: debit.userId,
              compensationLedgerEntryId: compensationLedgerEntry.id,
              deltaMicrocredits: requestedAmountMicrocredits.toString(),
              newBalanceMicrocredits: newBalanceMicrocredits.toString(),
              newAvailableCredits: newAvailableCredits.toString(),
              correlationId: correlationId ?? null,
            },
            // Why: Compensation outbox state must match the shared outbox contract at write time.
            status: OUTBOX_STATUSES.pending,
          },
        });

        return {
          compensated: true,
          ledgerEntryId: compensationLedgerEntry.id,
          walletId: debit.walletId,
          userId: debit.userId,
          originalLedgerEntryId: debit.id,
          originalDebitMicrocredits: debitMicrocredits.toString(),
          compensatedMicrocredits: requestedAmountMicrocredits.toString(),
          totalCompensatedMicrocredits:
            newTotalCompensatedMicrocredits.toString(),
          remainingUncompensatedMicrocredits: remainingUncompensated.toString(),
          walletBalanceMicrocredits: newBalanceMicrocredits.toString(),
          walletVersion: updatedWallet.version,
          compensatedAt: compensationLedgerEntry.createdAt.toISOString(),
        };
      });
    } catch (err: unknown) {
      // Rationale ("Why"): Catch concurrent unique constraint race conditions (P2002) on idempotencyKey.
      // Mechanism ("How"): If P2002 occurs, query the existing record: return original replay snapshot if identical, or 409 if conflict.
      // Invariants & Constraints: Never leak raw database 500 error to clients when two concurrent requests race on the same key.
      if (
        typeof err === "object" &&
        err !== null &&
        "code" in err &&
        (err as { code: string }).code === "P2002"
      ) {
        const existingEntry = await this.prisma.creditLedgerEntry.findUnique({
          where: { idempotencyKey: payload.idempotencyKey },
        });

        if (existingEntry) {
          if (
            existingEntry.requestFingerprint !== requestFingerprint ||
            existingEntry.originalLedgerEntryId !== debit.id ||
            existingEntry.deltaMicrocredits !== requestedAmountMicrocredits
          ) {
            throw problemException(
              BILLING_ERROR_CODES.idempotencyConflict,
              correlationId,
              { status: HttpStatus.CONFLICT },
            );
          }

          // Return immutable historical snapshot of the original transaction
          return await this.buildReplaySnapshot(
            this.prisma,
            existingEntry,
            debit,
            debitMicrocredits,
            requestedAmountMicrocredits,
            correlationId,
          );
        }

        throw problemException(
          BILLING_ERROR_CODES.idempotencyConflict,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      throw err;
    }
  }

  /**
   * Business purpose: Reconstruct immutable historical transaction snapshot for idempotent replay.
   *
   * Business rules:
   * - Must return historical balance and version from the time of compensation, not current wallet state.
   * - Must return original cumulative total and remaining uncompensated amounts.
   * - Replayed response must conform strictly to compensateBillingDebitResponseSchema.
   * - Must validate presence, types, and mathematical relationships of historical audit snapshot.
   * - Must validate that compensatedAt strictly conforms to ISO 8601 datetime per contract schema.
   * - Must validate synthesized response object against compensateBillingDebitResponseSchema before returning.
   * - If AuditEvent is missing or any snapshot fields/relations are corrupted, must fail closed with 422 BILLING_COMPENSATION_SNAPSHOT_CORRUPT.
   *
   * Execution flow:
   * 1. Query AuditEvent associated with the existing compensation ledger entry.
   * 2. If AuditEvent or its payload is missing, throw 422 BILLING_COMPENSATION_SNAPSHOT_CORRUPT.
   * 3. Validate types, bounds, and strict ISO 8601 datetime format of all snapshot fields.
   * 4. Verify mathematical invariant: totalCompensatedMicrocredits + remainingUncompensatedMicrocredits === debitMicrocredits.
   * 5. Construct and validate CompensateBillingDebitResponse against contract schema, returning historical snapshot.
   *
   * Failure cases:
   * - 422 BILLING_COMPENSATION_SNAPSHOT_CORRUPT if audit event is missing, incomplete, mathematically inconsistent, or fails schema validation.
   *
   * Side effects:
   * - Read-only query against AuditEvent; no persistence or state mutations.
   */
  private async buildReplaySnapshot(
    prismaOrTx: {
      auditEvent: {
        findFirst: (args: {
          where: { resourceId: string; eventType: string };
        }) => Promise<{ payload: unknown } | null>;
      };
    },
    existingEntry: {
      id: string;
      createdAt: Date;
    },
    debit: {
      id: string;
      walletId: string;
      userId: string;
    },
    debitMicrocredits: bigint,
    requestedAmountMicrocredits: bigint,
    correlationId: string,
  ): Promise<CompensateBillingDebitResponse> {
    const auditEvent = await prismaOrTx.auditEvent.findFirst({
      where: {
        resourceId: existingEntry.id,
        eventType: BILLING_AUDIT_EVENT_TYPES.compensationIssued,
      },
    });

    if (
      !auditEvent ||
      !auditEvent.payload ||
      typeof auditEvent.payload !== "object"
    ) {
      throw problemException(
        BILLING_ERROR_CODES.compensationSnapshotCorrupt,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const p = auditEvent.payload as Record<string, unknown>;

    // 1. Structural type validation
    const walletId = typeof p.walletId === "string" ? p.walletId.trim() : null;
    const userId = typeof p.userId === "string" ? p.userId.trim() : null;
    const walletBalanceMicrocredits =
      typeof p.newBalanceMicrocredits === "string" &&
      /^-?\d+$/.test(p.newBalanceMicrocredits)
        ? p.newBalanceMicrocredits
        : null;
    const walletVersion =
      typeof p.walletVersion === "number" &&
      Number.isInteger(p.walletVersion) &&
      p.walletVersion >= 0
        ? p.walletVersion
        : null;
    const totalCompensatedMicrocredits =
      typeof p.totalCompensatedMicrocredits === "string" &&
      /^\d+$/.test(p.totalCompensatedMicrocredits)
        ? p.totalCompensatedMicrocredits
        : null;
    const remainingUncompensatedMicrocredits =
      typeof p.remainingUncompensatedMicrocredits === "string" &&
      /^\d+$/.test(p.remainingUncompensatedMicrocredits)
        ? p.remainingUncompensatedMicrocredits
        : null;
    // Strict ISO 8601 datetime validation matching compensateBillingDebitResponseSchema (line 304)
    const compensatedAt =
      typeof p.compensatedAt === "string" &&
      z.string().datetime().safeParse(p.compensatedAt).success
        ? p.compensatedAt
        : null;

    if (
      !walletId ||
      !userId ||
      walletBalanceMicrocredits === null ||
      walletVersion === null ||
      totalCompensatedMicrocredits === null ||
      remainingUncompensatedMicrocredits === null ||
      !compensatedAt
    ) {
      throw problemException(
        BILLING_ERROR_CODES.compensationSnapshotCorrupt,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    // 2. Identity and relational parity validation
    if (walletId !== debit.walletId || userId !== debit.userId) {
      throw problemException(
        BILLING_ERROR_CODES.compensationSnapshotCorrupt,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    // 3. Mathematical relationship invariant:
    // totalCompensatedMicrocredits + remainingUncompensatedMicrocredits MUST equal debitMicrocredits
    const totalComp = BigInt(totalCompensatedMicrocredits);
    const remUncomp = BigInt(remainingUncompensatedMicrocredits);
    if (totalComp + remUncomp !== debitMicrocredits) {
      throw problemException(
        BILLING_ERROR_CODES.compensationSnapshotCorrupt,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const responseSnapshot: CompensateBillingDebitResponse = {
      compensated: true,
      ledgerEntryId: existingEntry.id,
      walletId,
      userId,
      originalLedgerEntryId: debit.id,
      originalDebitMicrocredits: debitMicrocredits.toString(),
      compensatedMicrocredits: requestedAmountMicrocredits.toString(),
      totalCompensatedMicrocredits,
      remainingUncompensatedMicrocredits,
      walletBalanceMicrocredits,
      walletVersion,
      compensatedAt,
    };

    // 4. Strict validation against canonical response contract schema
    const parsed =
      compensateBillingDebitResponseSchema.safeParse(responseSnapshot);
    if (!parsed.success) {
      throw problemException(
        BILLING_ERROR_CODES.compensationSnapshotCorrupt,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    return parsed.data;
  }
}
