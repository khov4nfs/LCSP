import { Inject } from "@nestjs/common";
import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import {
  BILLING_USAGE_KERNEL,
  type BillingUsagePort,
} from "../../shared/billing-usage.kernel.js";
import { ReserveBillingCreditsCommand } from "./reserve-billing-credits.command.js";

@CommandHandler(ReserveBillingCreditsCommand)
export class ReserveBillingCreditsHandler implements ICommandHandler<ReserveBillingCreditsCommand> {
  constructor(
    @Inject(BILLING_USAGE_KERNEL)
    private readonly billing: BillingUsagePort,
  ) {}

  execute(command: ReserveBillingCreditsCommand) {
    return this.billing.reserveForAssessment(command.input);
  }
}
