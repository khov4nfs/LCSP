import { Query } from "@nestjs/cqrs";

export class ListBillingReconciliationQuery extends Query<unknown> {
  constructor(
    public readonly status?: string,
    public readonly page?: number,
    public readonly take?: number,
  ) {
    super();
  }
}
