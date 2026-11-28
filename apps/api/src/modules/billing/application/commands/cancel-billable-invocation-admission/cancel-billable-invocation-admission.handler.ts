import { HttpStatus, Injectable } from "@nestjs/common";
import { CommandHandler, type ICommandHandler } from "@nestjs/cqrs";
import {
  ADMISSION_STATES,
  BILLING_ERROR_CODES,
  deriveAdmissionCapabilityDigest,
} from "@lcsp/contracts/billing";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { CancelBillableInvocationAdmissionCommand } from "./cancel-billable-invocation-admission.command.js";

export type CancelAdmissionExecutionResult = {
  admissionId: string;
  invocationId: string;
  state: string;
  slotReleased: boolean;
};

@Injectable()
@CommandHandler(CancelBillableInvocationAdmissionCommand)
export class CancelBillableInvocationAdmissionHandler implements ICommandHandler<
  CancelBillableInvocationAdmissionCommand,
  CancelAdmissionExecutionResult
> {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Business purpose: Atomically cancel an unconsumed ADMITTED admission before physical provider dispatch.
   *
   * Business rules:
   * - Only admissions currently in ADMITTED state can be cancelled directly by the worker.
   * - If consume won the race and transitioned the admission to IN_FLIGHT, cancellation must fail with 409 Conflict.
   * - Valid cancellation releases the wallet's concurrency slot and sets maximumExposureMicrocredits to 0.
   * - Capability token digest must match the stored record.
   * - Repeating a confirmed cancellation with the same capability returns its terminal result without another write.
   *
   * Execution flow:
   * 1. Query admission record by admissionId and invocationId.
   * 2. Verify capability token digest against stored digest.
   * 3. In an atomic transaction with row lock:
   *    a. If already CONFIRMED_NO_USAGE, replay the terminal slot-release receipt.
   *    b. If IN_FLIGHT, reject with 409 Conflict (admissionAlreadyInFlight).
   *    c. If not ADMITTED, reject with 422 Unprocessable (admissionInvalidState).
   *    d. Otherwise update state to CONFIRMED_NO_USAGE, set exposure to 0, and increment version.
   * 4. Return success result with slotReleased = true.
   *
   * Failure cases:
   * - Throws 404 NOT_FOUND if admission does not exist.
   * - Throws 422 UNPROCESSABLE_ENTITY if capability token digest does not match.
   * - Throws 409 CONFLICT if admission is already IN_FLIGHT.
   * - Throws 422 UNPROCESSABLE_ENTITY if admission is in another non-cancellable state.
   *
   * Side effects:
   * - Updates BillableInvocationAdmission record to CONFIRMED_NO_USAGE.
   * - Increments record version and resets exposure to 0.
   */
  // Rationale ("Why"): Allows orchestrators and workers to abort invocations before consume without consuming wallet concurrency.
  // Mechanism ("How"): Atomic CAS with row lock enforcing that only unconsumed ADMITTED records can be cancelled.
  // Invariants & Constraints: If consume already executed (IN_FLIGHT), cancellation must fail closed with 409.
  async execute(
    command: CancelBillableInvocationAdmissionCommand,
  ): Promise<CancelAdmissionExecutionResult> {
    const { payload, correlationId = "admission-cancel" } = command;

    const admission = await this.prisma.billableInvocationAdmission.findUnique({
      where: { invocationId: payload.invocationId },
    });

    if (!admission || admission.id !== payload.admissionId) {
      throw problemException(
        BILLING_ERROR_CODES.admissionNotFound,
        correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

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

    return await this.prisma.$transaction(async (tx) => {
      // Row lock on admission
      const [locked] = await tx.$queryRaw<
        Array<{ id: string; state: string; version: number }>
      >`
        SELECT id, state, version
        FROM "BillableInvocationAdmission"
        WHERE id = ${admission.id}
        FOR UPDATE
      `;

      if (!locked) {
        throw problemException(
          BILLING_ERROR_CODES.admissionNotFound,
          correlationId,
          { status: HttpStatus.NOT_FOUND },
        );
      }

      // Why: A worker may lose the response after the server committed a pre-consume cancellation.
      // How: Return the locked terminal receipt again without touching its version or exposure.
      // Invariant: The capability digest was verified above; IN_FLIGHT still cannot be worker-released.
      if (locked.state === ADMISSION_STATES.CONFIRMED_NO_USAGE) {
        return {
          admissionId: admission.id,
          invocationId: admission.invocationId,
          state: ADMISSION_STATES.CONFIRMED_NO_USAGE,
          slotReleased: true,
        };
      }

      if (locked.state === ADMISSION_STATES.IN_FLIGHT) {
        throw problemException(
          BILLING_ERROR_CODES.admissionAlreadyInFlight,
          correlationId,
          { status: HttpStatus.CONFLICT },
        );
      }

      if (locked.state !== ADMISSION_STATES.ADMITTED) {
        throw problemException(
          BILLING_ERROR_CODES.admissionInvalidState,
          correlationId,
          { status: HttpStatus.UNPROCESSABLE_ENTITY },
        );
      }

      await tx.billableInvocationAdmission.update({
        where: { id: locked.id },
        data: {
          state: ADMISSION_STATES.CONFIRMED_NO_USAGE,
          maximumExposureMicrocredits: 0n,
          version: { increment: 1 },
        },
      });

      return {
        admissionId: admission.id,
        invocationId: admission.invocationId,
        state: ADMISSION_STATES.CONFIRMED_NO_USAGE,
        slotReleased: true,
      };
    });
  }
}
