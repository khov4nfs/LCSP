import { Query } from "@nestjs/cqrs";
import type { BillingHistoryView } from "@lcsp/contracts/billing";

export class ListBillingHistoryQuery extends Query<BillingHistoryView> {
  constructor(
    public readonly userId: string,
    public readonly page: number,
    public readonly pageSize: number,
  ) {
    super();
  }
}
