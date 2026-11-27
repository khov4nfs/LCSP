import { HttpStatus, Injectable } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { ConfigService } from "@nestjs/config";
import {
  ADMISSION_STATES,
  BILLING_ERROR_CODES,
  deriveAdmissionCapabilityDigest,
} from "@lcsp/contracts/billing";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { HeartbeatBillableInvocationAdmissionCommand } from "./heartbeat-billable-invocation-admission.command.js";

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Handler for renewing or extending the in-flight execution lease of an active billable invocation.
 */
@Injectable()
@CommandHandler(HeartbeatBillableInvocationAdmissionCommand)
export class HeartbeatBillableInvocationAdmissionHandler implements ICommandHandler<HeartbeatBillableInvocationAdmissionCommand> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  /**
   * Business purpose: Extend the in-flight lease deadline of an active billable invocation while strictly maintaining run identity and approved runtime authority boundaries.
   *
   * Business rules:
   * - Caller must present a cryptographically verified capabilityToken matching the admission.
   * - Only invocations currently in IN_FLIGHT state can have their lease renewed.
   * - Non-in-flight invocations (e.g. ADMITTED, SETTLED, EXPIRED) reject with 409 Conflict.
   * - The underlying execution lease (AssessmentRuntime or RuleSetPreparationRun) must match the admission's pinned runId and executionLeaseToken; superseded runs or mismatched lease tokens reject with 403 Forbidden.
   * - The underlying execution lease must be active and unexpired; expired authority rejects with 403 Forbidden.
   * - Monotonicity invariant: Heartbeat can never shorten an existing deadline.
   * - Ceiling invariant: Heartbeat can never extend beyond the server-approved runtime execution deadline.
   * - Concurrency protection: The admission row and AssessmentRuntime are locked within the same transaction to prevent races with concurrent lease modifications.
   * - Extension duration defaults to 15 minutes (900 seconds) if not explicitly requested.
   *
   * Execution flow:
   * 1. Derive SHA-256 digest from presented capabilityToken.
   * 2. Within a PostgreSQL transaction, lock admission row FOR UPDATE.
   * 3. Verify invocationId and capabilityDigest match; verify admission is in IN_FLIGHT state.
   * 4. Lock AssessmentRuntime, AssessmentDiscoveryRun, or RuleSetPreparationRun FOR SHARE; sample clock_timestamp() immediately after acquiring each respective lock.
   * 5. Verify exact match on runId, executionLeaseToken, and unexpired leaseExpiresAt; reject with 403 on mismatch or expiry.
   * 6. Re-verify runtimeCeiling against latest clock_timestamp immediately before calculating deadline.
   * 7. Calculate new deadline enforcing monotonicity (never shorter than current) and clamping to runtime authority ceiling.
   * 8. Atomically update inFlightLeaseExpiresAt and increment version on BillableInvocationAdmission.
   * 9. Return confirmed extension payload with new expiration timestamp.
   *
   * Failure cases:
   * - Mismatched token, changed runId, or superseded execution lease token: throws 403 Forbidden.
   * - Expired or revoked runtime execution authority: throws 403 Forbidden.
   * - Admission not found: throws 404 Not Found.
   * - Admission not in IN_FLIGHT state: throws 409 Conflict.
   * - Concurrency conflict on version update: throws 409 Conflict.
   *
   * Side effects:
   * - Updates inFlightLeaseExpiresAt and increments version on BillableInvocationAdmission within transaction.
   */
  // Rationale ("Why"): Allows long-running model calls to remain active without false recovery sweeps while strictly respecting server authority limits and preventing dead runs from piggybacking on replaced executions even after lock waits.
  // Mechanism ("How"): Within a single transaction, row-locks admission FOR UPDATE, locks AssessmentRuntime / AssessmentDiscoveryRun / RuleSetPreparationRun FOR SHARE, queries clock_timestamp() after acquiring each respective lock to capture true elapsed time, validates capability token and exact runId/leaseToken alignment, enforces monotonic extension, clamps to runtime ceiling, and commits atomic update.
  // Invariants & Constraints: Only works on IN_FLIGHT admissions; rejects replaced or superseded executions with 403 Forbidden; uses clock_timestamp() after lock acquisition to prevent stale NOW() evaluation; re-verifies runtime ceiling immediately before extending deadline; never shortens deadline; never exceeds runtime authority ceiling.
  async execute(command: HeartbeatBillableInvocationAdmissionCommand): Promise<{
    admissionId: string;
    invocationId: string;
    state: string;
    inFlightLeaseExpiresAt: string;
  }> {
    const { payload, correlationId } = command;

    return await this.prisma.$transaction(async (tx) => {
      // 1. Lock and fetch admission row
      // Why: Serialize concurrent heartbeats, consumes, or sweepers for the same admission record.
      const [admission] = await tx.$queryRaw<
        Array<{
          id: string;
          invocationId: string;
          capabilityDigest: string;
          state: string;
          version: number;
          inFlightLeaseExpiresAt: Date | null;
          assessmentId: string | null;
          preparationRunId: string | null;
          runId: string;
          executionLeaseToken: string | null;
        }>
      >`
        SELECT 
          id,
          "invocationId",
          "capabilityDigest",
          state,
          version,
          "inFlightLeaseExpiresAt",
          "assessmentId",
          "preparationRunId",
          "runId",
          "executionLeaseToken"
        FROM "BillableInvocationAdmission"
        WHERE id = ${payload.admissionId}
        FOR UPDATE;
      `;

      if (!admission) {
        throw problemException(BILLING_ERROR_CODES.notFound, correlationId, {
          status: HttpStatus.NOT_FOUND,
        });
      }

      if (admission.invocationId !== payload.invocationId) {
        throw problemException(
          BILLING_ERROR_CODES.admissionContextMismatch,
          correlationId,
          { status: HttpStatus.FORBIDDEN },
        );
      }

      const providedDigest = deriveAdmissionCapabilityDigest(
        payload.capabilityToken,
      );
      if (admission.capabilityDigest !== providedDigest) {
        throw problemException(
          BILLING_ERROR_CODES.admissionContextMismatch,
          correlationId,
          { status: HttpStatus.FORBIDDEN },
        );
      }

      if (admission.state !== ADMISSION_STATES.IN_FLIGHT) {
        throw problemException(
          BILLING_ERROR_CODES.reservationTransition,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      // 2. Protect against race with lease changes and verify exact run ownership
      // Why: Prevent a superseded run or mismatched lease token from renewing under another execution's lease.
      // How: Lock AssessmentRuntime FOR SHARE inside transaction, and verify runId, executionLeaseToken, and leaseExpiresAt.
      // Invariants: In-flight invocation lease can never outlive the server-approved runtime execution window of its pinned run.
      let runtimeCeiling: Date | null = null;
      let dbUtcNow = new Date();

      if (admission.assessmentId) {
        const [runtime] = await tx.$queryRaw<
          Array<{
            assessmentId: string;
            currentExecutionId: string | null;
            threadId: string;
            leaseToken: string | null;
            leaseExpiresAt: Date | null;
            executionState: string;
          }>
        >`
          SELECT "assessmentId", "currentExecutionId", "threadId", "leaseToken", "leaseExpiresAt", "executionState"
          FROM "AssessmentRuntime"
          WHERE "assessmentId" = ${admission.assessmentId}
          FOR SHARE;
        `;

        // Obtain actual DB wall-clock time after acquiring AssessmentRuntime lock
        // Why: PostgreSQL NOW() freezes at transaction start. If request waited for row locks, NOW() does not reflect elapsed time.
        // How: Use clock_timestamp() immediately before evaluating expiry.
        const [postLockTime] = await tx.$queryRaw<Array<{ now: Date }>>`
          SELECT clock_timestamp() as now;
        `;
        dbUtcNow = postLockTime?.now ?? new Date();

        const isRuntimeValid =
          runtime &&
          runtime.leaseToken &&
          runtime.leaseToken === admission.executionLeaseToken &&
          runtime.leaseExpiresAt &&
          runtime.leaseExpiresAt.getTime() > dbUtcNow.getTime() &&
          (runtime.currentExecutionId === admission.runId ||
            runtime.threadId === admission.runId);

        if (isRuntimeValid) {
          runtimeCeiling = runtime.leaseExpiresAt;
        } else {
          let isDiscoveryValid = false;
          if (UUID_REGEX.test(admission.runId)) {
            const [discoveryRun] = await tx.$queryRaw<
              Array<{
                runId: string;
                assessmentId: string;
                leaseToken: string | null;
                leaseExpiresAt: Date | null;
                status: string;
              }>
            >`
              SELECT "runId", "assessmentId", "leaseToken", "leaseExpiresAt", status
              FROM "AssessmentDiscoveryRun"
              WHERE "runId" = ${admission.runId}::uuid
              FOR SHARE;
            `;

            // Capture actual DB wall-clock time after acquiring AssessmentDiscoveryRun lock
            // Why: If heartbeat had to wait for a concurrent lock on AssessmentDiscoveryRun, time advanced during this second wait.
            // How: Sample clock_timestamp() immediately after acquiring the discovery run lock.
            const [postDiscoveryLockTime] = await tx.$queryRaw<
              Array<{ now: Date }>
            >`
              SELECT clock_timestamp() as now;
            `;
            dbUtcNow = postDiscoveryLockTime?.now ?? dbUtcNow;

            if (
              discoveryRun &&
              discoveryRun.assessmentId === admission.assessmentId &&
              discoveryRun.leaseToken &&
              discoveryRun.leaseToken === admission.executionLeaseToken &&
              discoveryRun.leaseExpiresAt &&
              discoveryRun.leaseExpiresAt.getTime() > dbUtcNow.getTime()
            ) {
              isDiscoveryValid = true;
              runtimeCeiling = discoveryRun.leaseExpiresAt;
            }
          }

          if (!isDiscoveryValid) {
            throw problemException(
              BILLING_ERROR_CODES.admissionContextMismatch,
              correlationId,
              { status: HttpStatus.FORBIDDEN },
            );
          }
        }
      } else if (admission.preparationRunId) {
        const [prepRun] = await tx.$queryRaw<
          Array<{ id: string; executionState: string }>
        >`
          SELECT id, "executionState"
          FROM "RuleSetPreparationRun"
          WHERE id = ${admission.preparationRunId}
          FOR SHARE;
        `;

        // Capture actual DB wall-clock time after acquiring RuleSetPreparationRun lock
        const [postLockTime] = await tx.$queryRaw<Array<{ now: Date }>>`
          SELECT clock_timestamp() as now;
        `;
        dbUtcNow = postLockTime?.now ?? new Date();

        if (!prepRun || prepRun.executionState !== "RUNNING") {
          throw problemException(
            BILLING_ERROR_CODES.admissionContextMismatch,
            correlationId,
            { status: HttpStatus.FORBIDDEN },
          );
        }
      } else {
        throw problemException(
          BILLING_ERROR_CODES.admissionContextMismatch,
          correlationId,
          { status: HttpStatus.FORBIDDEN },
        );
      }

      // Re-verify runtimeCeiling against latest clock_timestamp immediately before calculating deadline
      // Why: If runtime ceiling expired during lock waits, heartbeat must fail closed with 403 Forbidden.
      if (runtimeCeiling && runtimeCeiling.getTime() <= dbUtcNow.getTime()) {
        throw problemException(
          BILLING_ERROR_CODES.admissionContextMismatch,
          correlationId,
          { status: HttpStatus.FORBIDDEN },
        );
      }

      const extensionSeconds = payload.extensionSeconds ?? 900;
      const extensionMs = extensionSeconds * 1000;
      const requestedDeadlineMs = dbUtcNow.getTime() + extensionMs;

      // Invariant: Heartbeat must be monotonic; it can NEVER shorten an existing deadline!
      const currentDeadlineMs = admission.inFlightLeaseExpiresAt
        ? admission.inFlightLeaseExpiresAt.getTime()
        : dbUtcNow.getTime();
      let calculatedDeadlineMs = Math.max(
        currentDeadlineMs,
        requestedDeadlineMs,
      );

      // Invariant: Heartbeat cannot extend beyond the server-approved runtime execution deadline!
      if (runtimeCeiling && calculatedDeadlineMs > runtimeCeiling.getTime()) {
        calculatedDeadlineMs = runtimeCeiling.getTime();
      }

      const inFlightLeaseExpiresAt = new Date(calculatedDeadlineMs);

      await tx.billableInvocationAdmission.update({
        where: { id: admission.id },
        data: {
          inFlightLeaseExpiresAt,
          version: { increment: 1 },
        },
      });

      return {
        admissionId: admission.id,
        invocationId: admission.invocationId,
        state: ADMISSION_STATES.IN_FLIGHT,
        inFlightLeaseExpiresAt: inFlightLeaseExpiresAt.toISOString(),
      };
    });
  }
}
