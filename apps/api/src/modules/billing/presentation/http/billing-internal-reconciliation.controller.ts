/**
 * Why: Provides internal endpoints for reconciliation worker operations, including lease sweep
 * and exposure maintenance (ADR-028 Line 92, Line 155).
 * How: Guarded by WorkerApiKeyGuard; validates input using ZodValidationPipe; executes CQRS command
 * and wraps output in standard result envelope.
 * Invariants: Endpoints are internal-only; no public client access permitted; responses strictly follow
 * the canonical result envelope format.
 */

import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import {
  BILLING_ERROR_CODES,
  sweepExpiredLeasesRequestSchema,
  type SweepExpiredLeasesRequest,
} from "@lcsp/contracts/billing";
import { WorkerApiKeyGuard } from "../../../../platform/rbac/guards/worker-api-key.guard.js";
import { ZodValidationPipe } from "../../../../platform/http/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { SweepExpiredInvocationLeasesCommand } from "../../application/commands/sweep-expired-invocation-leases/sweep-expired-invocation-leases.command.js";

/**
 * Controller handling internal billing reconciliation recovery operations.
 */
@Controller("internal/billing/reconciliation")
@UseGuards(WorkerApiKeyGuard)
export class BillingInternalReconciliationController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Business purpose: Sweeps expired in-flight invocation leases to DISPATCH_UNKNOWN and opens
   * reconciliation cases so that financial exposure is retained and slots remain blocked.
   *
   * Business rules:
   * - Caller must provide a valid worker API key (`x-worker-api-key`).
   * - Batch size is validated and constrained between 1 and 500 (default 50).
   * - Expired IN_FLIGHT leases are transitioned to DISPATCH_UNKNOWN with exposure retained.
   *
   * Execution flow:
   * 1. Validate request body against `sweepExpiredLeasesRequestSchema`.
   * 2. Extract correlation ID from headers.
   * 3. Dispatch `SweepExpiredInvocationLeasesCommand`.
   * 4. Wrap response in standard `resultEnvelope`.
   *
   * Failure cases:
   * - Invalid request body returns 400 with VALIDATION_FAILED.
   * - Missing or invalid worker API key returns 401/403.
   *
   * Side effects:
   * - Mutates database records for expired admissions and reconciliation cases.
   */
  // Rationale ("Why"): Enables automated or manual recovery workers to reclaim hung in-flight slots safely.
  // Mechanism ("How"): Validates request body, forwards to CQRS sweeper handler, envelopes result.
  // Invariants & Constraints: Worker API key authentication required; preserves financial exposure.
  @Post("sweep-expired-leases")
  @HttpCode(HttpStatus.OK)
  async sweepExpiredLeases(
    @Body(
      new ZodValidationPipe(
        sweepExpiredLeasesRequestSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: SweepExpiredLeasesRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    const result = await this.commandBus.execute(
      new SweepExpiredInvocationLeasesCommand(body, correlationId),
    );

    return resultEnvelope(result);
  }
}
