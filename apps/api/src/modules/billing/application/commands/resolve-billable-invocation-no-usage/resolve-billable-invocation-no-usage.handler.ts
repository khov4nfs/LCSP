import { HttpStatus, Injectable } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  ADMISSION_STATES,
  BILLING_ERROR_CODES,
  RECONCILIATION_CASE_STATES,
} from "@lcsp/contracts/billing";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { ReconciliationArtifactService } from "../../shared/reconciliation-artifact.service.js";
import { ResolveBillableInvocationNoUsageCommand } from "./resolve-billable-invocation-no-usage.command.js";

export type ResolveNoUsageExecutionResult = {
  caseId: string;
  invocationId: string;
  state: string;
  slotReleased: boolean;
};

// Authoritative server-side registry of providers that support correlation ID tracking
const PROVIDERS_SUPPORTING_CORRELATION = new Set(["anthropic", "openai"]);

@Injectable()
@CommandHandler(ResolveBillableInvocationNoUsageCommand)
export class ResolveBillableInvocationNoUsageHandler
  implements ICommandHandler<ResolveBillableInvocationNoUsageCommand, ResolveNoUsageExecutionResult>
{
  constructor(
    private readonly prisma: PrismaService,
    private readonly artifactService: ReconciliationArtifactService,
  ) {}

  /**
   * Business purpose: Authoritatively resolve a DISPATCH_UNKNOWN or OUTCOME_UNKNOWN admission to CONFIRMED_NO_USAGE
   * through independent, cryptographically verified provider audit log evidence stored durably in PostgreSQL.
   *
   * Business rules:
   * - Must be executed by an Admin with RBAC permissions.
   * - Provider must be authoritatively known to record client correlation IDs.
   * - Provider audit log artifact must exist in durable database storage with verified=true.
   * - The provider log window must encompass the entire potential dispatch window (from admittedAt through dispatch timeout).
   * - Log entries must be verified to contain ZERO requests matching the invocation's correlationId.
   * - If a competing late settlement already transitioned the admission to SETTLED, reconciliation must fail closed with 409 CONFLICT.
   * - State transition and closing of BillingReconciliationCase occur in the SAME transaction under row lock.
   *
   * Execution flow:
   * 1. Check whether provider supports correlation ID tracking; reject with 422 if unsupported.
   * 2. Begin database transaction with row lock FOR UPDATE on BillableInvocationAdmission.
   * 3. If admission is already SETTLED, reject with 409 Conflict.
   * 4. If admission is not in DISPATCH_UNKNOWN or OUTCOME_UNKNOWN, reject with 422 Unprocessable.
   * 5. Calculate potential dispatch window and verify coverage bounds.
   * 6. Verify artifact integrity, temporal window, and non-dispatch via ReconciliationArtifactService.
   * 7. Transition admission to CONFIRMED_NO_USAGE, reset exposure to 0, and increment version.
   * 8. Upsert/update BillingReconciliationCase to CONFIRMED_NO_USAGE in the same transaction.
   * 9. Return resolution result with slotReleased = true.
   *
   * Failure cases:
   * - Throws 404 NOT_FOUND if admission does not exist.
   * - Throws 409 CONFLICT if admission is already SETTLED by a competing late settlement.
   * - Throws 422 UNPROCESSABLE_ENTITY if provider does not support correlation ID tracking.
   * - Throws 422 UNPROCESSABLE_ENTITY if evidence artifact is missing, unverified, hash mismatch, or contains dispatched call.
   * - Throws 422 UNPROCESSABLE_ENTITY if temporal coverage window is incomplete.
   *
   * Side effects:
   * - Updates BillableInvocationAdmission to CONFIRMED_NO_USAGE and resets maximumExposureMicrocredits = 0.
   * - Updates BillingReconciliationCase to CONFIRMED_NO_USAGE.
   * - Releases wallet concurrency slot.
   */
  // Rationale ("Why"): ADR-028 Line 155 specifies that only durable, admission-bound no-usage proof can close exposure.
  // Mechanism ("How"): Enforces authoritative provider correlation verification, content-addressed SHA-256 check, and atomic row locking.
  // Invariants & Constraints: Late settlement cannot be overwritten; reconciliation and case close in single atomic transaction.
  async execute(
    command: ResolveBillableInvocationNoUsageCommand,
  ): Promise<ResolveNoUsageExecutionResult> {
    const { payload, correlationId = "recon-resolve-no-usage" } = command;

    // Invariant: Automated CONFIRMED_NO_USAGE slot release is kept strictly closed by default
    // until an audited operational provider log ingestion channel is provisioned.
    if (process.env.PROVIDER_RECONCILIATION_AUTOMATED_RELEASE !== "ON") {
      throw problemException(
        BILLING_ERROR_CODES.providerCorrelationUnsupported,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    // Invariant: Server-side check for provider correlation capability
    const normalizedProvider = payload.provider.trim().toLowerCase();
    if (!PROVIDERS_SUPPORTING_CORRELATION.has(normalizedProvider)) {
      throw problemException(
        BILLING_ERROR_CODES.providerCorrelationUnsupported,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    return await this.prisma.$transaction(async (tx) => {
      // 1. Lock admission row with FOR UPDATE to prevent race with late settlement
      const [lockedAdmission] = await tx.$queryRaw<
        Array<{
          id: string;
          state: string;
          version: number;
          resolvedProvider: string;
          correlationId: string;
          admittedAt: Date;
          expiresAt: Date;
          consumedAt: Date | null;
        }>
      >`
        SELECT id, state, version, "resolvedProvider", "correlationId", "admittedAt", "expiresAt", "consumedAt"
        FROM "BillableInvocationAdmission"
        WHERE "invocationId" = ${payload.invocationId}
        FOR UPDATE
      `;

      if (!lockedAdmission) {
        throw problemException(
          BILLING_ERROR_CODES.admissionNotFound,
          correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }

      // Check competing late settlement
      if (lockedAdmission.state === ADMISSION_STATES.SETTLED) {
        throw problemException(
          BILLING_ERROR_CODES.admissionAlreadySettled,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      if (
        lockedAdmission.state !== ADMISSION_STATES.DISPATCH_UNKNOWN &&
        lockedAdmission.state !== ADMISSION_STATES.OUTCOME_UNKNOWN
      ) {
        throw problemException(
          BILLING_ERROR_CODES.admissionInvalidState,
          correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }

      // 2. Strict Potential Dispatch Window Calculation
      // Start: strictly <= admittedAt
      // End: if consumed, must cover at least 300s timeout after consumedAt or expiresAt, whichever is later.
      const potentialDispatchStart = lockedAdmission.admittedAt;
      const potentialDispatchEnd = lockedAdmission.consumedAt
        ? new Date(
            Math.max(
              lockedAdmission.expiresAt.getTime(),
              lockedAdmission.consumedAt.getTime() + 300_000,
            ),
          )
        : lockedAdmission.expiresAt;

      const coverageStart = new Date(payload.providerLogCoverageStart);
      const coverageEnd = new Date(payload.providerLogCoverageEnd);

      if (
        coverageStart > potentialDispatchStart ||
        coverageEnd < potentialDispatchEnd
      ) {
        throw problemException(
          BILLING_ERROR_CODES.incompleteReconciliationWindow,
          correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }

      // 3. Verify evidence artifact from durable PostgreSQL storage
      const verification = await this.artifactService.verifyArtifact({
        artifactId: payload.providerLogArtifactId,
        expectedSha256: payload.providerLogArchiveSha256,
        expectedProvider: lockedAdmission.resolvedProvider,
        correlationId: lockedAdmission.correlationId,
        potentialDispatchStart,
        potentialDispatchEnd,
        coverageStart,
        coverageEnd,
      });

      if (!verification.verified) {
        if (
          verification.error === "incomplete_coverage" ||
          verification.error === "window_out_of_bounds" ||
          verification.error === "future_watermark"
        ) {
          throw problemException(
            BILLING_ERROR_CODES.incompleteReconciliationWindow,
            correlationId,
            { status: HttpStatus.UNPROCESSABLE_ENTITY },
          );
        }

        // All other errors (artifact_not_found, unverified_artifact_source, hash_mismatch, provider_mismatch, dispatched_request_found)
        throw problemException(
          BILLING_ERROR_CODES.invalidReconciliationEvidence,
          correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }

      const now = new Date();

      // 4. Atomic transition on BillableInvocationAdmission: CONFIRMED_NO_USAGE & clear exposure
      await tx.billableInvocationAdmission.update({
        where: { id: lockedAdmission.id },
        data: {
          state: ADMISSION_STATES.CONFIRMED_NO_USAGE,
          maximumExposureMicrocredits: 0n,
          settledAt: now,
          version: { increment: 1 },
        },
      });

      // 5. Atomic upsert/update on BillingReconciliationCase in the same transaction
      await tx.billingReconciliationCase.upsert({
        where: { invocationId: payload.invocationId },
        create: {
          caseId: payload.caseId,
          invocationId: payload.invocationId,
          admissionId: lockedAdmission.id,
          state: RECONCILIATION_CASE_STATES.CONFIRMED_NO_USAGE,
          provider: payload.provider,
          providerCorrelationId: payload.providerCorrelationId,
          providerLogArtifactId: payload.providerLogArtifactId,
          providerLogArchiveSha256: payload.providerLogArchiveSha256,
          coverageStart,
          coverageEnd,
          resolvedAt: now,
          resolvedBy: "admin",
          auditRationale: payload.auditRationale,
          version: 1,
        },
        update: {
          state: RECONCILIATION_CASE_STATES.CONFIRMED_NO_USAGE,
          providerLogArtifactId: payload.providerLogArtifactId,
          providerLogArchiveSha256: payload.providerLogArchiveSha256,
          coverageStart,
          coverageEnd,
          resolvedAt: now,
          resolvedBy: "admin",
          auditRationale: payload.auditRationale,
          version: { increment: 1 },
        },
      });

      return {
        caseId: payload.caseId,
        invocationId: payload.invocationId,
        state: ADMISSION_STATES.CONFIRMED_NO_USAGE,
        slotReleased: true,
      };
    });
  }
}
