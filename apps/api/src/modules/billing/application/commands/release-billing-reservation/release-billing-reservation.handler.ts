import { Inject } from "@nestjs/common";
import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import {
  BILLING_USAGE_KERNEL,
  type BillingUsagePort,
} from "../../shared/billing-usage.kernel.js";
import { ReleaseBillingReservationCommand } from "./release-billing-reservation.command.js";

@CommandHandler(ReleaseBillingReservationCommand)
export class ReleaseBillingReservationHandler implements ICommandHandler<ReleaseBillingReservationCommand> {
  constructor(
    @Inject(BILLING_USAGE_KERNEL)
    private readonly billing: BillingUsagePort,
  ) {}

  execute(command: ReleaseBillingReservationCommand) {
    return this.billing.releaseForAssessment(command.input);
  }
}
