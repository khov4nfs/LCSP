import { Query } from "@nestjs/cqrs";
import type { BillingOrderView } from "@lcsp/contracts/billing";

export class GetBillingOrderQuery extends Query<BillingOrderView> {
  constructor(
    public readonly userId: string,
    public readonly orderId: string,
  ) {
    super();
  }
}
