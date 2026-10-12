import { Inject } from "@nestjs/common";
import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import {
  BILLING_USAGE_KERNEL,
  type BillingUsagePort,
} from "../../shared/billing-usage.kernel.js";
import { RecordLlmUsageCommand } from "./record-llm-usage.command.js";

@CommandHandler(RecordLlmUsageCommand)
export class RecordLlmUsageHandler implements ICommandHandler<RecordLlmUsageCommand> {
  constructor(
    @Inject(BILLING_USAGE_KERNEL)
    private readonly billing: BillingUsagePort,
  ) {}

  execute(command: RecordLlmUsageCommand) {
    return this.billing.recordUsage(command.input);
  }
}
