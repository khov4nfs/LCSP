import { Command } from "@nestjs/cqrs";
import type { BillingUsageReservationInput } from "../billing-usage.types.js";

export class ReserveBillingCreditsCommand extends Command<unknown> {
  constructor(public readonly input: BillingUsageReservationInput) {
    super();
  }
}
