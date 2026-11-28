/**
 * Why: Sweeper handler for transitioning expired in-flight invocation leases to DISPATCH_UNKNOWN
 * and opening reconciliation cases (ADR-028 Line 92, Line 155).
 * How: Scans expired IN_FLIGHT leases, transitions state in isolated transactions, retains exposure ceiling,
 * and opens OPEN reconciliation cases to maintain financial safety boundaries.
 * Invariants: Maximum financial exposure is never zeroed or reduced on lease expiration; concurrency slots
 * remain held until verified settlement or audited administrative closure.
 */

import { Injectable, Logger } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  ADMISSION_STATES,
  BILLING_AUDIT_EVENT_TYPES,
  RECONCILIATION_CASE_STATES,
  type SweepExpiredLeasesResponse,
} from "@lcsp/contracts/billing";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  toPrismaAdmissionState,
  toPrismaAuthDecision,
  toPrismaAuditResourceType,
  toPrismaBillingReconciliationState,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { SweepExpiredInvocationLeasesCommand } from "./sweep-expired-invocation-leases.command.js";

@Injectable()
@CommandHandler(SweepExpiredInvocationLeasesCommand)
export class SweepExpiredInvocationLeasesHandler implements ICommandHandler<
  SweepExpiredInvocationLeasesCommand,
  SweepExpiredLeasesResponse
> {
  private readonly logger = new Logger(
    SweepExpiredInvocationLeasesHandler.name,
  );

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Sweeps expired IN_FLIGHT invocation leases into DISPATCH_UNKNOWN and opens
   * reconciliation cases so financial exposure is strictly preserved and slots remain held.
   *
   * Business rules:
   * - Only admissions currently in IN_FLIGHT state with `inFlightLeaseExpiresAt <= now` are eligible for sweep; admission TTL does not end an in-flight call.
   * - Transition to DISPATCH_UNKNOWN must strictly retain `maximumExposureMicrocredits` without zeroing or reduction.
   * - A `BillingReconciliationCase` must be opened in `OPEN` state linked to the admission and invocation.
   * - Provider correlation must be copied from the locked admission, not inferred from its invocation ID.
   * - Preserving maximum exposure guarantees that the concurrency slot remains blocked from unverified retries.
   *
   * Execution flow:
   * 1. Determine batch size from command payload (bounded by contract schema 1-500, default 50).
   * 2. Query expired IN_FLIGHT admissions ordered by expiration timestamp ascending.
   * 3. For each expired admission, execute an atomic transaction:
   *    a. Verify admission is still in IN_FLIGHT state within transaction lock.
   *    b. Update admission state to DISPATCH_UNKNOWN while preserving maximumExposureMicrocredits.
   *    c. Upsert `BillingReconciliationCase` with state OPEN and operational audit rationale.
   *    d. Record `AuditEvent` documenting the recovery sweep event.
   * 4. Log telemetry and return the count of swept admissions and opened reconciliation cases.
   *
   * Failure cases:
   * - Database connectivity failure rolls back individual transactions and logs error.
   * - Concurrent settlement or resolution skips already-transitioned admissions without corruption.
   *
   * Side effects:
   * - Updates `BillableInvocationAdmission` records from IN_FLIGHT to DISPATCH_UNKNOWN.
   * - Creates `BillingReconciliationCase` records with OPEN status.
   * - Inserts `AuditEvent` audit records for system tracing.
   */
  async execute(
    command: SweepExpiredInvocationLeasesCommand,
  ): Promise<SweepExpiredLeasesResponse> {
    const { payload, correlationId } = command;
    const batchSize = payload.batchSize ?? 50;
    const now = new Date();

    // Query candidate expired admissions
    // Why: Sweeper must evaluate the dedicated in-flight lease clock (inFlightLeaseExpiresAt), NOT admission TTL (expiresAt).
    // How: Filter by state: IN_FLIGHT and inFlightLeaseExpiresAt <= now.
    // Invariants: Pre-consume admission TTL (expiresAt) does not prematurely terminate active in-flight invocations.
    const candidates = await this.prisma.billableInvocationAdmission.findMany({
      where: {
        state: toPrismaAdmissionState(ADMISSION_STATES.IN_FLIGHT),
        inFlightLeaseExpiresAt: { lte: now },
      },
      take: batchSize,
      orderBy: { inFlightLeaseExpiresAt: "asc" },
      select: {
        id: true,
        invocationId: true,
        resolvedProvider: true,
        maximumExposureMicrocredits: true,
        inFlightLeaseExpiresAt: true,
        userId: true,
      },
    });

    let sweptCount = 0;
    let reconciliationCasesOpened = 0;

    for (const candidate of candidates) {
      try {
        await this.prisma.$transaction(async (tx) => {
          // Re-fetch with row lock to avoid race conditions with concurrent worker settlement
          const locked = await tx.$queryRaw<
            Array<{
              id: string;
              state: string;
              inFlightLeaseExpiresAt: Date | null;
              correlationId: string;
            }>
          >`
            SELECT id, state, "inFlightLeaseExpiresAt", "correlationId"
            FROM "BillableInvocationAdmission"
            WHERE id = ${candidate.id}
            FOR UPDATE
          `;

          if (
            !locked.length ||
            locked[0]?.state !==
              toPrismaAdmissionState(ADMISSION_STATES.IN_FLIGHT) ||
            !locked[0]?.inFlightLeaseExpiresAt ||
            locked[0].inFlightLeaseExpiresAt.getTime() > now.getTime()
          ) {
            // Already settled or transitioned by concurrent process
            return;
          }

          // 1. Transition state to DISPATCH_UNKNOWN while retaining maximumExposureMicrocredits
          await tx.billableInvocationAdmission.update({
            where: { id: candidate.id },
            data: {
              state: toPrismaAdmissionState(ADMISSION_STATES.DISPATCH_UNKNOWN),
              // Invariant: maximumExposureMicrocredits is explicitly UNTOUCHED to retain financial risk
            },
          });

          // 2. Open BillingReconciliationCase
          const caseId = `recon-${candidate.invocationId}`;
          await tx.billingReconciliationCase.upsert({
            where: { invocationId: candidate.invocationId },
            create: {
              id: crypto.randomUUID(),
              caseId,
              invocationId: candidate.invocationId,
              admissionId: candidate.id,
              state: toPrismaBillingReconciliationState(
                RECONCILIATION_CASE_STATES.OPEN,
              ),
              provider: candidate.resolvedProvider,
              // Why: Evidence lookup must use the ID sent to the provider, which can differ from invocationId.
              // How: Persist the correlation ID read under the admission row lock.
              // Invariant: Admin must not confirm no usage by searching provider logs for the wrong identity.
              providerCorrelationId: locked[0].correlationId,
              auditRationale:
                "Swept expired IN_FLIGHT lease to DISPATCH_UNKNOWN; awaiting provider usage receipt or verified no-usage evidence",
            },
            update: {
              state: toPrismaBillingReconciliationState(
                RECONCILIATION_CASE_STATES.OPEN,
              ),
              updatedAt: now,
            },
          });

          // 3. Audit trail
          await tx.auditEvent.create({
            data: {
              id: crypto.randomUUID(),
              eventType: BILLING_AUDIT_EVENT_TYPES.leaseSwept,
              actorId: "system:reconciliation-sweeper",
              correlationId: correlationId ?? `sweep-${candidate.invocationId}`,
              resourceType: toPrismaAuditResourceType(
                AUDIT_RESOURCE_TYPES.httpRoute,
              ),
              resourceId: candidate.id,
              decision: toPrismaAuthDecision(AUDIT_DECISIONS.allow),
              payload: {
                admissionId: candidate.id,
                invocationId: candidate.invocationId,
                previousState: ADMISSION_STATES.IN_FLIGHT,
                newState: ADMISSION_STATES.DISPATCH_UNKNOWN,
                sweptAt: now.toISOString(),
                exposureRetainedMicrocredits:
                  candidate.maximumExposureMicrocredits.toString(),
              },
            },
          });

          sweptCount++;
          reconciliationCasesOpened++;
        });
      } catch (err) {
        this.logger.error(
          `Failed to sweep expired lease for admission ${candidate.id} (invocation: ${candidate.invocationId})`,
          err,
        );
      }
    }

    return {
      sweptCount,
      reconciliationCasesOpened,
    };
  }
}
