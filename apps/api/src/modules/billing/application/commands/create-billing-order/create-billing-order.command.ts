import { Command } from "@nestjs/cqrs";
import type { BillingOrderAudit } from "../billing-usage.types.js";

export class CreateBillingOrderCommand extends Command<unknown> {
  constructor(
    public readonly userId: string,
    public readonly amountVnd: bigint,
    public readonly idempotencyKey: string,
    public readonly audit: BillingOrderAudit,
  ) {
    super();
  }
}
