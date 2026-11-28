/**
 * Rationale ("Why"): Enables Admin investigation of a disputed or unknown model invocation case.
 * Mechanism ("How"): Queries BillingReconciliationCase, linked BillableInvocationAdmission, and linked ProviderLogArtifact.
 * Invariants & Constraints: Read-only query; fails with 404 BILLING_NOT_FOUND if caseId does not exist.
 */

import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";
import { HttpStatus, Injectable } from "@nestjs/common";
import {
  BILLING_ERROR_CODES,
  BILLING_ROLLOUT_MODES,
  CREDIT_LEDGER_SOURCES,
  MODEL_USAGE_DEBIT_MODES,
  type BillingReconciliationCaseDetailResponse,
} from "@lcsp/contracts/billing";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { GetBillingReconciliationCaseDetailQuery } from "./get-billing-reconciliation-case-detail.query.js";

@Injectable()
@QueryHandler(GetBillingReconciliationCaseDetailQuery)
export class GetBillingReconciliationCaseDetailHandler implements IQueryHandler<
  GetBillingReconciliationCaseDetailQuery,
  BillingReconciliationCaseDetailResponse
> {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Retrieve full case details and linked cryptographic provider log evidence for a reconciliation case.
   *
   * Business rules:
   * - Caller must be an authenticated administrator.
   * - Case must exist in PostgreSQL database.
   * - Must return linked admission, financial exposure, and verified provider log artifact if present.
   * - A compensation preview is available only for one verified debit belonging to this admission and wallet.
   *
   * Execution flow:
   * 1. Query BillingReconciliationCase by unique caseId, including linked admission.
   * 2. If record is missing, throw 404 BILLING_NOT_FOUND.
   * 3. If providerLogArtifactId is present, query ProviderLogArtifact record.
   * 4. Verify any original debit against its receipt and sum prior compensations.
   * 5. Map entities to canonical BillingReconciliationCaseDetailResponse contract.
   *
   * Failure cases:
   * - 404 BILLING_NOT_FOUND if caseId does not exist in database.
   *
   * Side effects:
   * - Pure read query; no database state mutations.
   */
  async execute(
    query: GetBillingReconciliationCaseDetailQuery,
  ): Promise<BillingReconciliationCaseDetailResponse> {
    const { caseId } = query;

    const r = await this.prisma.billingReconciliationCase.findUnique({
      where: { caseId },
      include: {
        admission: true,
      },
    });

    if (!r) {
      throw problemException(BILLING_ERROR_CODES.notFound, caseId, {
        status: HttpStatus.NOT_FOUND,
      });
    }

    let evidenceArtifact: BillingReconciliationCaseDetailResponse["evidenceArtifact"] =
      null;
    if (r.providerLogArtifactId) {
      const art = await this.prisma.providerLogArtifact.findUnique({
        where: { artifactId: r.providerLogArtifactId },
      });
      if (art) {
        evidenceArtifact = {
          artifactId: art.artifactId,
          provider: art.provider,
          sha256: art.sha256,
          coverageStart: art.coverageStart.toISOString(),
          coverageEnd: art.coverageEnd.toISOString(),
          verified: art.verified,
          ingestedAt: art.ingestedAt.toISOString(),
        };
      }
    }

    let compensationPreview: BillingReconciliationCaseDetailResponse["compensationPreview"] =
      null;
    if (
      r.admission.walletId &&
      r.admission.userId &&
      r.admission.debitMode === MODEL_USAGE_DEBIT_MODES.ON &&
      r.admission.rolloutMode === BILLING_ROLLOUT_MODES.DEBIT_ENABLED
    ) {
      // Why: A case may refer to unknown usage or platform funding and have no legitimate customer debit.
      // How: Read at most two debit rows bound to this admission and wallet; ambiguity suppresses the preview.
      // Invariant: UI never receives an arbitrary debit ID or an amount derived from request payload.
      const debits = await this.prisma.creditLedgerEntry.findMany({
        where: {
          admissionId: r.admissionId,
          walletId: r.admission.walletId,
          userId: r.admission.userId,
          source: CREDIT_LEDGER_SOURCES.MODEL_USAGE_DEBIT,
        },
        select: { id: true, deltaMicrocredits: true },
        take: 2,
      });
      const debit = debits.length === 1 ? debits[0] : undefined;
      if (
        debit &&
        debit.deltaMicrocredits !== null &&
        debit.deltaMicrocredits < 0n
      ) {
        const originalDebit = -debit.deltaMicrocredits;
        const receipt = await this.prisma.modelUsageReceipt.findUnique({
          where: { admissionId: r.admissionId },
          select: { debitedMicrocredits: true },
        });
        if (receipt?.debitedMicrocredits === originalDebit) {
          const prior = await this.prisma.creditLedgerEntry.findMany({
            where: {
              originalLedgerEntryId: debit.id,
              source: CREDIT_LEDGER_SOURCES.COMPENSATION,
            },
            select: { walletId: true, userId: true, deltaMicrocredits: true },
          });
          // Why: A malformed compensation row must not make the preview disagree with the mutation's ceiling.
          // How: Sum every compensation linked to the original debit, then suppress the preview on invalid ownership or amount.
          // Invariant: Displayed remaining credit is advisory; the mutation still recomputes it under the wallet lock.
          const priorIsValid = prior.every(
            (entry) =>
              entry.walletId === r.admission.walletId &&
              entry.userId === r.admission.userId &&
              entry.deltaMicrocredits !== null &&
              entry.deltaMicrocredits > 0n,
          );
          const totalCompensated = prior.reduce(
            (sum, entry) => sum + (entry.deltaMicrocredits ?? 0n),
            0n,
          );
          if (priorIsValid && totalCompensated <= originalDebit) {
            compensationPreview = {
              originalLedgerEntryId: debit.id,
              originalDebitMicrocredits: originalDebit.toString(),
              totalCompensatedMicrocredits: totalCompensated.toString(),
              remainingUncompensatedMicrocredits: (
                originalDebit - totalCompensated
              ).toString(),
            };
          }
        }
      }
    }

    return {
      caseId: r.caseId,
      invocationId: r.invocationId,
      admissionId: r.admissionId,
      state: r.state,
      provider: r.provider,
      providerCorrelationId: r.providerCorrelationId,
      providerLogArtifactId: r.providerLogArtifactId,
      coverageStart: r.coverageStart?.toISOString() ?? null,
      coverageEnd: r.coverageEnd?.toISOString() ?? null,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      resolvedBy: r.resolvedBy,
      auditRationale: r.auditRationale,
      conflictDetectedAt: r.conflictDetectedAt?.toISOString() ?? null,
      conflictingPayload:
        (r.conflictingPayload as Record<string, unknown>) ?? null,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      admission: {
        id: r.admission.id,
        invocationId: r.admission.invocationId,
        walletId: r.admission.walletId,
        userId: r.admission.userId,
        maximumExposureMicrocredits:
          r.admission.maximumExposureMicrocredits.toString(),
        state: r.admission.state,
        rolloutMode: r.admission.rolloutMode,
        debitMode: r.admission.debitMode,
        requestedModel: r.admission.requestedModel,
        resolvedProvider: r.admission.resolvedProvider,
        resolvedModel: r.admission.resolvedModel,
        admittedAt: r.admission.admittedAt.toISOString(),
        consumedAt: r.admission.consumedAt?.toISOString() ?? null,
        expiresAt: r.admission.expiresAt.toISOString(),
      },
      evidenceArtifact,
      compensationPreview,
    };
  }
}
