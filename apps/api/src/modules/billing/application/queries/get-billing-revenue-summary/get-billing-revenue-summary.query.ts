import { Query } from "@nestjs/cqrs";

export class GetBillingRevenueSummaryQuery extends Query<unknown> {
  constructor(
    public readonly from?: string,
    public readonly to?: string,
  ) {
    super();
  }
}
