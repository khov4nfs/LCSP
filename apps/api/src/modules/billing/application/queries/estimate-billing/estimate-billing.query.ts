import { Query } from "@nestjs/cqrs";
import type { BillingUsageEstimate } from "@lcsp/contracts/billing";

export class EstimateBillingQuery extends Query<BillingUsageEstimate> {
  constructor(
    public readonly userId: string,
    public readonly amountVnd: bigint,
  ) {
    super();
  }
}
