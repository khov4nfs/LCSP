import { Inject } from "@nestjs/common";
import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import {
  BILLING_USAGE_KERNEL,
  type BillingUsagePort,
} from "../../shared/billing-usage.kernel.js";
import { SettleBillingUsageCommand } from "./settle-billing-usage.command.js";

@CommandHandler(SettleBillingUsageCommand)
export class SettleBillingUsageHandler implements ICommandHandler<SettleBillingUsageCommand> {
  constructor(
    @Inject(BILLING_USAGE_KERNEL)
    private readonly billing: BillingUsagePort,
  ) {}

  execute(command: SettleBillingUsageCommand) {
    return this.billing.recordAndSettleUsage(command.input);
  }
}
