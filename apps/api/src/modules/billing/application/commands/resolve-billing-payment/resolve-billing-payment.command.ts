import { Command } from "@nestjs/cqrs";
import type { BillingAdminResolveInput } from "../billing-usage.types.js";

export class ResolveBillingPaymentCommand extends Command<unknown> {
  constructor(public readonly input: BillingAdminResolveInput) {
    super();
  }
}
