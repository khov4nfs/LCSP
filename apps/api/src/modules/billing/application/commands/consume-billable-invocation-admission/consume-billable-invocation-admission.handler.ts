import { HttpStatus, Inject, Injectable } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import { AGENT_EXECUTION_STATES } from "@lcsp/contracts/assessment";
import {
  ADMISSION_STATES,
  BILLING_ERROR_CODES,
  deriveAdmissionCapabilityDigest,
} from "@lcsp/contracts/billing";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import {
  MODEL_PRICING_REPOSITORY,
  type ModelPricingRepositoryPort,
} from "../../../domain/repositories/model-pricing.port.js";
import { ConsumeBillableInvocationAdmissionCommand } from "./consume-billable-invocation-admission.command.js";

export type ConsumeAdmissionExecutionResult = {
  admissionId: string;
  invocationId: string;
  state: string;
  consumedAt: string;
  inFlightLeaseExpiresAt: string;
};

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

// Why: These are transaction-local result discriminators, not public execution statuses.
// How: Distinct lowercase names let the handler commit an expiry before translating it to an HTTP problem.
// Invariant: The outward admission state still comes from the shared ADMISSION_STATES contract.
const CONSUME_TRANSACTION_RESULTS = {
  committed: "committed",
  expired: "expired",
} as const;

@Injectable()
@CommandHandler(ConsumeBillableInvocationAdmissionCommand)
export class ConsumeBillableInvocationAdmissionHandler implements ICommandHandler<
  ConsumeBillableInvocationAdmissionCommand,
  ConsumeAdmissionExecutionResult
> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(MODEL_PRICING_REPOSITORY)
    private readonly modelPricingRepo: ModelPricingRepositoryPort,
  ) {}

  /**
   * Business purpose: Commit an ADMITTED invocation to IN_FLIGHT state via atomic CAS before first provider byte dispatch, strictly bounded by the approved execution deadline of the owning run and synchronized with execution authority.
   *
   * Business rules:
   * - Worker must present the exact capability token matching the server-stored SHA-256 digest.
   * - TTL must be strictly enforced: an admission whose expiresAt has passed must transition to EXPIRED and fail closed with 422 outside the committing transaction.
   * - Transition must verify active execution lease matching runId and executionLeaseToken with AssessmentRuntime locked FOR SHARE within the transaction; expired or superseded runs reject with 403 Forbidden.
   * - inFlightLeaseExpiresAt is bounded by approvedDeadline (e.g. 5 minutes if run only has 5 minutes left) and never defaults to 15m when the run deadline is shorter.
   * - Replaying consume on an already IN_FLIGHT admission returns the current state idempotently.
   * - Conflicting states (e.g. CANCELLED, CONFIRMED_NO_USAGE) reject with 409 Conflict.
   *
   * Execution flow:
   * 1. In a PostgreSQL transaction, lock admission row FOR UPDATE.
   * 2. Verify capabilityToken digest against stored capabilityDigest.
   * 3. If already IN_FLIGHT, return existing consumed state idempotently.
   * 4. If state is not ADMITTED, reject with concurrencyConflict (409 Conflict).
   * 5. If expiresAt <= now, transition to EXPIRED, commit transaction, and throw admissionExpired (422) outside transaction.
   * 6. Lock AssessmentRuntime, AssessmentDiscoveryRun, or RuleSetPreparationRun FOR SHARE; sample clock_timestamp() immediately after acquiring each respective lock.
   * 7. Verify runId, executionLeaseToken, and leaseExpiresAt > clock_timestamp().
   * 8. Re-evaluate unconsumed admission TTL (expiresAt <= clock_timestamp()) after final authority lock wait; commit EXPIRED via sentinel if expired during wait.
   * 9. Re-verify approved execution lease deadline against final clock_timestamp immediately before state transition.
   * 10. Assign inFlightLeaseExpiresAt bounded strictly by approvedDeadline of the run.
   * 11. Atomically update state to IN_FLIGHT, record consumedAt, and increment version.
   * 12. Commit transaction and return consumed admission metadata.
   *
   * Failure cases:
   * - Throws 404 NOT_FOUND if admissionId or invocationId does not exist.
   * - Throws 422 UNPROCESSABLE_ENTITY if capabilityToken does not match digest.
   * - Throws 422 UNPROCESSABLE_ENTITY if admission has expired (committed to EXPIRED first).
   * - Throws 409 CONFLICT if admission is in a conflicting state (e.g. cancelled).
   * - Throws 403 FORBIDDEN if runtime execution authority has expired or run has been superseded.
   *
   * Side effects:
   * - Mutates BillableInvocationAdmission state to IN_FLIGHT (or EXPIRED upon TTL timeout).
   * - Sets inFlightLeaseExpiresAt and consumedAt.
   * - Increments record version.
   */
  // Rationale ("Why"): Prevents race conditions where execution lease is replaced between reading and CAS update, guarantees worker has verified server authorization, and ensures in-flight lease never outlives approved run authority even after lock waits.
  // Mechanism ("How"): Executes inside a PostgreSQL transaction: locks admission FOR UPDATE, captures real-time clock via clock_timestamp() after lock waits, checks capability and state, commits EXPIRED if TTL passed, locks AssessmentRuntime / AssessmentDiscoveryRun / RuleSetPreparationRun FOR SHARE to verify exact runId/leaseToken alignment against updated clock_timestamp(), re-evaluates TTL and lease deadline after final lock acquisition, assigns bounded lease, and commits CAS transition.
  // Invariants & Constraints: Atomic execution; only unexpired ADMITTED records with matching digest and valid runtime authority can transition to IN_FLIGHT; uses clock_timestamp() after lock acquisition to prevent stale NOW() evaluation; never allows expired TTL or expired lease to transition to IN_FLIGHT.
  async execute(
    command: ConsumeBillableInvocationAdmissionCommand,
  ): Promise<ConsumeAdmissionExecutionResult> {
    const { payload, correlationId = "admission-consume" } = command;

    const result = await this.prisma.$transaction(async (tx) => {
      // 1. Row-lock admission FOR UPDATE
      // Why: Serialize concurrent consume, heartbeat, sweep, or cancel operations on this admission record.
      const [admission] = await tx.$queryRaw<
        Array<{
          id: string;
          invocationId: string;
          capabilityDigest: string;
          state: string;
          version: number;
          expiresAt: Date;
          inFlightLeaseExpiresAt: Date | null;
          consumedAt: Date | null;
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
          "expiresAt",
          "inFlightLeaseExpiresAt",
          "consumedAt",
          "assessmentId",
          "preparationRunId",
          "runId",
          "executionLeaseToken"
        FROM "BillableInvocationAdmission"
        WHERE id = ${payload.admissionId}
          AND "invocationId" = ${payload.invocationId}
        FOR UPDATE;
      `;

      if (!admission) {
        throw problemException(
          BILLING_ERROR_CODES.admissionNotFound,
          correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }

      // 2. Obtain actual DB wall-clock time after acquiring admission lock
      // Why: PostgreSQL NOW() returns transaction start time, which freezes before lock waits.
      // How: Use clock_timestamp() to capture true elapsed time during any lock queueing.
      const [postLockTime] = await tx.$queryRaw<Array<{ now: Date }>>`
        SELECT clock_timestamp() as now;
      `;
      const dbUtcNow = postLockTime?.now ?? new Date();

      // Validate capability token digest
      // Why: Ensure the caller holds the cryptographic proof issued by the server for this exact admission and invocation.
      // How: Compare SHA-256 digest of supplied token against stored capabilityDigest.
      // Invariants: Forged or altered capability tokens cannot consume an admission.
      const expectedDigest = deriveAdmissionCapabilityDigest(
        payload.capabilityToken,
      );
      if (admission.capabilityDigest !== expectedDigest) {
        throw problemException(
          BILLING_ERROR_CODES.admissionCapabilityMismatch,
          correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }

      // Idempotent retry: if already IN_FLIGHT, return existing timestamp
      // Why: Lost-response retries or recovery routines may re-send consume for an already in-flight call.
      // How: Return 200 immediately without evaluating TTL, as TTL applies strictly to unconsumed ADMITTED state.
      // Invariants: In-flight calls are not affected by unconsumed admission TTL expiration.
      if (admission.state === ADMISSION_STATES.IN_FLIGHT) {
        return {
          kind: CONSUME_TRANSACTION_RESULTS.committed,
          data: {
            admissionId: admission.id,
            invocationId: admission.invocationId,
            state: admission.state,
            consumedAt: (admission.consumedAt ?? dbUtcNow).toISOString(),
            inFlightLeaseExpiresAt: (
              admission.inFlightLeaseExpiresAt ?? dbUtcNow
            ).toISOString(),
          },
        };
      }

      // Only ADMITTED admissions can be consumed; any other state represents a concurrency conflict (e.g. cancelled)
      if (admission.state !== ADMISSION_STATES.ADMITTED) {
        throw problemException(
          BILLING_ERROR_CODES.concurrencyConflict,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      // Check TTL expiration: TTL applies strictly to ADMITTED admissions
      // Why: Unconsumed admissions must not linger indefinitely; if past 5 minutes, mark EXPIRED and free the slot.
      // How: Commit EXPIRED state in transaction before raising 422 problem exception outside transaction (controlled commit).
      if (admission.expiresAt.getTime() <= dbUtcNow.getTime()) {
        await tx.billableInvocationAdmission.update({
          where: { id: admission.id },
          data: {
            state: ADMISSION_STATES.EXPIRED,
            version: { increment: 1 },
          },
        });
        return { kind: CONSUME_TRANSACTION_RESULTS.expired };
      }

      // Verify active execution authority of the EXACT run
      // Why: Admission cannot be consumed if the underlying run authority has expired, run was replaced, or lease token mismatched.
      // How: Lock AssessmentRuntime FOR SHARE within the same transaction to prevent race with concurrent lease updates.
      // Invariants: Pinned runId and executionLeaseToken must match active lease, and leaseExpiresAt must be strictly in the future.
      let approvedDeadline: Date | null = null;
      let finalUtcNow: Date;

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

        // Capture actual DB wall-clock time after acquiring AssessmentRuntime lock
        // Why: If consume had to wait for a concurrent transaction on AssessmentRuntime, wall-clock time advanced during the wait.
        // How: Use clock_timestamp() so that any elapsed wait time past leaseExpiresAt is accurately detected.
        const [postRuntimeLockTime] = await tx.$queryRaw<Array<{ now: Date }>>`
          SELECT clock_timestamp() as now;
        `;
        finalUtcNow = postRuntimeLockTime?.now ?? dbUtcNow;

        const isRuntimeValid =
          runtime &&
          runtime.leaseToken &&
          runtime.leaseToken === admission.executionLeaseToken &&
          runtime.leaseExpiresAt &&
          runtime.leaseExpiresAt.getTime() > finalUtcNow.getTime() &&
          (runtime.currentExecutionId === admission.runId ||
            runtime.threadId === admission.runId);

        if (isRuntimeValid) {
          approvedDeadline = runtime.leaseExpiresAt;
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
            // Why: If consume had to wait for a concurrent lock on AssessmentDiscoveryRun, time advanced during this second wait.
            // How: Sample clock_timestamp() immediately after acquiring the discovery run lock.
            const [postDiscoveryLockTime] = await tx.$queryRaw<
              Array<{ now: Date }>
            >`
              SELECT clock_timestamp() as now;
            `;
            finalUtcNow = postDiscoveryLockTime?.now ?? finalUtcNow;

            if (
              discoveryRun &&
              discoveryRun.assessmentId === admission.assessmentId &&
              discoveryRun.leaseToken &&
              discoveryRun.leaseToken === admission.executionLeaseToken &&
              discoveryRun.leaseExpiresAt &&
              discoveryRun.leaseExpiresAt.getTime() > finalUtcNow.getTime()
            ) {
              isDiscoveryValid = true;
              approvedDeadline = discoveryRun.leaseExpiresAt;
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
        const [postPrepLockTime] = await tx.$queryRaw<Array<{ now: Date }>>`
          SELECT clock_timestamp() as now;
        `;
        finalUtcNow = postPrepLockTime?.now ?? dbUtcNow;

        // Why: Preparation leases must use the same canonical execution-state value as the Assessment runtime.
        if (
          !prepRun ||
          prepRun.executionState !== AGENT_EXECUTION_STATES.RUNNING
        ) {
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

      // Re-verify admission TTL against finalUtcNow after all row locks have been acquired
      // Why: While waiting in queue for AssessmentRuntime, AssessmentDiscoveryRun, or RuleSetPreparationRun locks,
      // the unconsumed admission's TTL (expiresAt) may have elapsed.
      // How: Use finalUtcNow to evaluate admission.expiresAt. If expired, commit EXPIRED state in DB and return sentinel.
      // Invariants: Unconsumed admissions that expire during lock wait must be marked EXPIRED, never transitioning to IN_FLIGHT.
      if (admission.expiresAt.getTime() <= finalUtcNow.getTime()) {
        await tx.billableInvocationAdmission.update({
          where: { id: admission.id },
          data: {
            state: ADMISSION_STATES.EXPIRED,
            version: { increment: 1 },
          },
        });
        return { kind: CONSUME_TRANSACTION_RESULTS.expired };
      }

      // Re-verify approved execution lease deadline against finalUtcNow immediately before state transition
      // Why: Ensure lease has not expired by the millisecond preceding the state transition.
      if (
        approvedDeadline &&
        approvedDeadline.getTime() <= finalUtcNow.getTime()
      ) {
        throw problemException(
          BILLING_ERROR_CODES.admissionContextMismatch,
          correlationId,
          { status: HttpStatus.FORBIDDEN },
        );
      }

      // Bound inFlightLeaseExpiresAt strictly by approvedDeadline (e.g. 5 minutes if run only has 5m left)
      // Why: A model invocation must NEVER exceed the approved execution deadline of its run.
      // How: When approvedDeadline is present, set inFlightLeaseExpiresAt = approvedDeadline. If run has 5m, lease is 5m (never defaulted to 15m).
      const defaultLeaseMs = 15 * 60 * 1000;
      const inFlightLeaseExpiresAt =
        approvedDeadline ?? new Date(finalUtcNow.getTime() + defaultLeaseMs);

      const updated = await tx.billableInvocationAdmission.update({
        where: { id: admission.id },
        data: {
          state: ADMISSION_STATES.IN_FLIGHT,
          consumedAt: finalUtcNow,
          inFlightLeaseExpiresAt,
          version: { increment: 1 },
        },
      });

      return {
        kind: CONSUME_TRANSACTION_RESULTS.committed,
        data: {
          admissionId: updated.id,
          invocationId: updated.invocationId,
          state: updated.state,
          consumedAt: updated.consumedAt!.toISOString(),
          inFlightLeaseExpiresAt: updated.inFlightLeaseExpiresAt!.toISOString(),
        },
      };
    });

    if (result.kind === CONSUME_TRANSACTION_RESULTS.expired) {
      throw problemException(
        BILLING_ERROR_CODES.admissionExpired,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    return result.data;
  }
}
