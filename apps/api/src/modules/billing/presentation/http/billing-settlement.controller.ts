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
  billableInvocationSettlementRequestSchema,
  type BillableInvocationSettlementRequest,
} from "@lcsp/contracts/billing";
import { WorkerApiKeyGuard } from "../../../../platform/rbac/guards/worker-api-key.guard.js";
import { ZodValidationPipe } from "../../../../platform/http/pipes/zod-validation.pipe.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { SettleBillableInvocationUsageCommand } from "../../application/commands/settle-billable-invocation-usage/settle-billable-invocation-usage.command.js";

/**
 * Controller handling worker usage settlement and outcome reporting.
 */
@Controller("internal/billing/usage")
@UseGuards(WorkerApiKeyGuard)
export class BillingSettlementController {
  constructor(private readonly commandBus: CommandBus) {}

  /**
   * Business purpose: Settle physical LLM invocation usage or report failure/timeout.
   */
  // Rationale ("Why"): Allows workers to report token usage, settle bounded exposure, or transition unresolved calls to reconciliation.
  // Mechanism ("How"): Validates request body, delegates to SettleBillableInvocationUsageCommand, and returns result envelope.
  // Invariants & Constraints: Protected by WorkerApiKeyGuard; requires valid capability token.
  @Post("settle")
  @HttpCode(HttpStatus.OK)
  async settleUsage(
    @Body(
      new ZodValidationPipe(
        billableInvocationSettlementRequestSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: BillableInvocationSettlementRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    const result = await this.commandBus.execute(
      new SettleBillableInvocationUsageCommand(body, correlationId),
    );

    return resultEnvelope(result);
  }
}
