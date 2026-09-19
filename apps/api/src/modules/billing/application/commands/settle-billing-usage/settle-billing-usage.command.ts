import { Command } from "@nestjs/cqrs";
import type { BillingUsageSettlementInput } from "../billing-usage.types.js";

export class SettleBillingUsageCommand extends Command<unknown> {
  constructor(public readonly input: BillingUsageSettlementInput) {
    super();
  }
}
