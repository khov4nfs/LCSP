import { Query } from "@nestjs/cqrs";

export class EstimateBillingQuery extends Query<unknown> {
  constructor(public readonly amountVnd: bigint) {
    super();
  }
}
