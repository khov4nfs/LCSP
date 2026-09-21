import { Command } from "@nestjs/cqrs";
import type { BillingOrderAudit } from "../billing-usage.types.js";

export class ExpireBillingOrderCommand extends Command<void> {
  constructor(
    public readonly userId: string,
    public readonly orderId: string,
    public readonly audit: BillingOrderAudit,
  ) {
    super();
  }
}
