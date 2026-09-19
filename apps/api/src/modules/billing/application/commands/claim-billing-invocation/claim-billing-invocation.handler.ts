import { Inject } from "@nestjs/common";
import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import {
  BILLING_USAGE_KERNEL,
  type BillingUsagePort,
} from "../../shared/billing-usage.kernel.js";
import { ClaimBillingInvocationCommand } from "./claim-billing-invocation.command.js";

@CommandHandler(ClaimBillingInvocationCommand)
export class ClaimBillingInvocationHandler implements ICommandHandler<ClaimBillingInvocationCommand> {
  constructor(
    @Inject(BILLING_USAGE_KERNEL)
    private readonly billing: BillingUsagePort,
  ) {}

  execute(command: ClaimBillingInvocationCommand) {
    return this.billing.claimInvocation(command.input);
  }
}
