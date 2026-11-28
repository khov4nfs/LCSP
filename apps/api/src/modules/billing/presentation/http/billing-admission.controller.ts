import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Res,
  UseGuards,
} from "@nestjs/common";
import { CommandBus } from "@nestjs/cqrs";
import type { Response } from "express";
import {
  BILLING_ERROR_CODES,
  billableInvocationAdmissionConsumeSchema,
  billableInvocationAdmissionRequestSchema,
  billableInvocationCancelRequestSchema,
  billableInvocationHeartbeatRequestSchema,
  type BillableInvocationAdmissionConsume,
  type BillableInvocationAdmissionRequest,
  type BillableInvocationCancelRequest,
  type BillableInvocationHeartbeatRequest,
} from "@lcsp/contracts/billing";
import { WorkerApiKeyGuard } from "../../../../platform/rbac/guards/worker-api-key.guard.js";
import { ZodValidationPipe } from "../../../../platform/http/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RequestBillableInvocationAdmissionCommand } from "../../application/commands/request-billable-invocation-admission/request-billable-invocation-admission.command.js";
import { ConsumeBillableInvocationAdmissionCommand } from "../../application/commands/consume-billable-invocation-admission/consume-billable-invocation-admission.command.js";
import { HeartbeatBillableInvocationAdmissionCommand } from "../../application/commands/heartbeat-billable-invocation-admission/heartbeat-billable-invocation-admission.command.js";
import { CancelBillableInvocationAdmissionCommand } from "../../application/commands/cancel-billable-invocation-admission/cancel-billable-invocation-admission.command.js";
import type { RequestAdmissionExecutionResult } from "../../application/commands/request-billable-invocation-admission/request-billable-invocation-admission.handler.js";
import type { ConsumeAdmissionExecutionResult } from "../../application/commands/consume-billable-invocation-admission/consume-billable-invocation-admission.handler.js";
import type { CancelAdmissionExecutionResult } from "../../application/commands/cancel-billable-invocation-admission/cancel-billable-invocation-admission.handler.js";
import type { HeartbeatBillableInvocationAdmissionHandler } from "../../application/commands/heartbeat-billable-invocation-admission/heartbeat-billable-invocation-admission.handler.js";

/**
 * Controller handling worker-issued admission requests and atomic CAS consumption.
 */
@Controller("internal/billing/admission")
@UseGuards(WorkerApiKeyGuard)
export class BillingAdmissionController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Business purpose: Request admission for a billable invocation.
   * Returns HTTP 201 on new admission, or HTTP 200 on exact lost-response idempotent replay.
   */
  // Rationale ("Why"): Allows workers to reserve execution rights before invoking external LLM providers.
  // Mechanism ("How"): Validates request body, delegates to RequestBillableInvocationAdmissionCommand, and sets 201/200 status.
  // Invariants & Constraints: Protected by WorkerApiKeyGuard; requires valid capability token derivation.
  @Post("request")
  async requestAdmission(
    @Body(
      new ZodValidationPipe(
        billableInvocationAdmissionRequestSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: BillableInvocationAdmissionRequest,
    @Res({ passthrough: true }) response: Response,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    // Why: CQRS defaults to `any`; retain the handler result contract at the HTTP boundary.
    const result = await this.commandBus.execute<
      RequestBillableInvocationAdmissionCommand,
      RequestAdmissionExecutionResult
    >(new RequestBillableInvocationAdmissionCommand(body, correlationId));

    if (result.isReplay) {
      response.status(HttpStatus.OK);
    } else {
      response.status(HttpStatus.CREATED);
    }

    return resultEnvelope(result.data);
  }

  /**
   * Business purpose: Commit an ADMITTED invocation to IN_FLIGHT state via atomic CAS before first provider byte dispatch.
   */
  // Rationale ("Why"): Guarantees worker commits to invocation before contacting provider; prevents duplicate dispatches.
  // Mechanism ("How"): Validates consume token and delegates to ConsumeBillableInvocationAdmissionCommand.
  // Invariants & Constraints: Atomic CAS transition ADMITTED -> IN_FLIGHT.
  @Post("consume")
  @HttpCode(HttpStatus.OK)
  async consumeAdmission(
    @Body(
      new ZodValidationPipe(
        billableInvocationAdmissionConsumeSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: BillableInvocationAdmissionConsume,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    // Why: Preserve the typed consume result through the shared response envelope.
    const result = await this.commandBus.execute<
      ConsumeBillableInvocationAdmissionCommand,
      ConsumeAdmissionExecutionResult
    >(new ConsumeBillableInvocationAdmissionCommand(body, correlationId));

    return resultEnvelope(result);
  }

  /**
   * Business purpose: Cancel an unconsumed admission before physical provider dispatch.
   */
  // Rationale ("Why"): Allows orchestrators to abort cleanly before consume without holding concurrency slots.
  // Mechanism ("How"): Validates cancel request body and delegates to CancelBillableInvocationAdmissionCommand.
  // Invariants & Constraints: Atomic CAS only permitted if current state is ADMITTED; fails with 409 if IN_FLIGHT.
  @Post("cancel")
  @HttpCode(HttpStatus.OK)
  async cancelAdmission(
    @Body(
      new ZodValidationPipe(
        billableInvocationCancelRequestSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: BillableInvocationCancelRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    // Why: Preserve the typed cancellation result through the shared response envelope.
    const result = await this.commandBus.execute<
      CancelBillableInvocationAdmissionCommand,
      CancelAdmissionExecutionResult
    >(new CancelBillableInvocationAdmissionCommand(body, correlationId));

    return resultEnvelope(result);
  }

  /**
   * Business purpose: Renew or extend the in-flight lease deadline of an active model invocation.
   */
  // Rationale ("Why"): Allows long-running model inferences to continue without false recovery sweeps.
  // Mechanism ("How"): Validates heartbeat request body with capability token and delegates to HeartbeatBillableInvocationAdmissionCommand.
  // Invariants & Constraints: Permitted only when admission is currently IN_FLIGHT.
  @Post("heartbeat")
  @HttpCode(HttpStatus.OK)
  async heartbeatAdmission(
    @Body(
      new ZodValidationPipe(
        billableInvocationHeartbeatRequestSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: BillableInvocationHeartbeatRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    // Why: CQRS requires an explicit response type to avoid an unsafe HTTP payload.
    const result = await this.commandBus.execute<
      HeartbeatBillableInvocationAdmissionCommand,
      Awaited<
        ReturnType<HeartbeatBillableInvocationAdmissionHandler["execute"]>
      >
    >(new HeartbeatBillableInvocationAdmissionCommand(body, correlationId));

    return resultEnvelope(result);
  }
}
