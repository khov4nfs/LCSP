import { Command } from "@nestjs/cqrs";
import type { BillingAdminRejectInput } from "../billing-usage.types.js";

export class RejectBillingPaymentCommand extends Command<unknown> {
  constructor(public readonly input: BillingAdminRejectInput) {
    super();
  }
}
