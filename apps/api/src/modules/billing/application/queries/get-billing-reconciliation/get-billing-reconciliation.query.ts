import { Query } from "@nestjs/cqrs";

export class GetBillingReconciliationQuery extends Query<unknown> {
  constructor(public readonly paymentId: string) {
    super();
  }
}
