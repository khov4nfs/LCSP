/**
 * Rationale ("Why"): G-07 Transaction Compensation & Debit Linking handler skeleton.
 * Mechanism ("How"): Dispatched by CommandBus from BillingAdminController, enforces admin authority.
 * Invariants & Constraints: Must lock row FOR UPDATE, enforce cumulative bounds, and commit 4 records atomically.
 */

import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { HttpStatus, Injectable } from "@nestjs/common";
import { AUTH_ERROR_CODES, AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  BILLING_ACTIONS,
  BILLING_ERROR_CODES,
  BILLING_ROLLOUT_MODES,
  CREDIT_LEDGER_SOURCES,
  MODEL_USAGE_DEBIT_MODES,
  type CompensateBillingDebitResponse,
} from "@lcsp/contracts/billing";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { CompensateBillingDebitCommand } from "./compensate-billing-debit.command.js";

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
   * - Caller must possess admin role and explicit compensation action permission.
   * - Original debit must exist, have source MODEL_USAGE_DEBIT, and have valid admissionId + ModelUsageReceipt linkage.
   * - Cumulative compensation cannot exceed original debit amount under serialized row lock.
   * - Idempotent by idempotencyKey: identical replay returns prior result; conflict returns 409.
   * - Available credits projected from resulting microcredit balance, not added as integer division.
   * - Atomic 4-record commit: CreditLedgerEntry + BillingWallet + AuditEvent + OutboxMessage.
   *
   * Execution flow:
   * 1. Validate caller admin role and action permission.
   * 2. Lock BillingWallet and original debit aggregate in transaction.
   * 3. Verify debit eligibility and admission/receipt linkage.
   * 4. Check idempotency and cumulative ceiling.
   * 5. Append compensation ledger entry, project wallet, write audit event and outbox message.
   * 6. Return CompensateBillingDebitResponse.
   *
   * Failure cases:
   * - 403 if caller lacks admin role or action authority.
   * - 404 if original debit does not exist.
   * - 422 if debit is not eligible or cumulative limit is exceeded.
   * - 409 if idempotency conflict occurs.
   *
   * Side effects:
   * - Appends CreditLedgerEntry, updates BillingWallet, writes AuditEvent and OutboxMessage.
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

    // Rationale ("Why"): Pre-implementation RED verification stub for subsequent transaction operations.
    // Mechanism ("How"): Return unpersisted response so tests 4-9 fail authentically on missing persistence / bounds.
    // Invariants & Constraints: Allows RED suite to verify each branch independently without a single generic throw.
    return {
      compensated: false,
      ledgerEntryId: "",
      originalLedgerEntryId: debit.id,
      originalDebitMicrocredits: debitMicrocredits.toString(),
      compensatedMicrocredits: requestedAmountMicrocredits.toString(),
      totalCompensatedMicrocredits: "0",
      remainingUncompensatedMicrocredits: debitMicrocredits.toString(),
      walletBalanceMicrocredits: "0",
      walletVersion: 0,
      replayed: false,
    };
  }
}
