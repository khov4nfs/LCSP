import { Query } from "@nestjs/cqrs";
import type { BillingPrepaidEstimate } from "@lcsp/contracts/billing";

export class EstimateBillingQuery extends Query<BillingPrepaidEstimate> {
  constructor(public readonly amountVnd: bigint) {
    super();
  }
}
