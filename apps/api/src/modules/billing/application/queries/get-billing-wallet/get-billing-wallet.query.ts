import { Query } from "@nestjs/cqrs";

export class GetBillingWalletQuery extends Query<unknown> {
  constructor(public readonly userId: string) {
    super();
  }
}
