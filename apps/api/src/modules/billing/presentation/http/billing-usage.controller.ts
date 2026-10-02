import { Body, Controller, Post, UseGuards } from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import {
  BILLING_ERROR_CODES,
  billingLlmUsageReportSchema,
  type BillingLlmUsageReportRequest,
} from "@lcsp/contracts/billing";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.ts";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RecordLlmUsageCommand } from "../../application/commands/record-llm-usage/record-llm-usage.command.js";
import { ResolveBillingAssessmentOwnerQuery } from "../../application/queries/resolve-billing-assessment-owner/resolve-billing-assessment-owner.query.js";
import { serializeBillingData } from "./mappers/billing-http.response.mapper.js";
import { toLlmUsageRecordInput } from "./mappers/billing-usage.request.mapper.js";
import { mapUsageError } from "./errors/billing-http.error-mapper.js";

/** Internal worker callback: provider token telemetry only, no wallet effect. */
@Controller("internal/billing")
export class BillingUsageController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post("usage")
  @UseGuards(WorkerApiKeyGuard)
  async recordUsage(
    @Body(
      new ZodValidationPipe(
        billingLlmUsageReportSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: BillingLlmUsageReportRequest,
  ) {
    try {
      const userId = await this.queryBus.execute(
        new ResolveBillingAssessmentOwnerQuery(body.assessmentId),
      );
      const result = await this.commandBus.execute(
        new RecordLlmUsageCommand(toLlmUsageRecordInput(body, userId)),
      );
      return resultEnvelope(serializeBillingData(result));
    } catch (error) {
      throw mapUsageError(error);
    }
  }
}
