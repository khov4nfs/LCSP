import { Command } from "@nestjs/cqrs";
import type { BillingUsageClaimInput } from "../billing-usage.types.js";

export class ClaimBillingInvocationCommand extends Command<unknown> {
  constructor(public readonly input: BillingUsageClaimInput) {
    super();
  }
}
