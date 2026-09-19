import { Command } from "@nestjs/cqrs";
import type { BillingUsageReleaseInput } from "../billing-usage.types.js";

export class ReleaseBillingReservationCommand extends Command<unknown> {
  constructor(public readonly input: BillingUsageReleaseInput) {
    super();
  }
}
