import { Query } from "@nestjs/cqrs";

export class ListBillingReconciliationQuery extends Query<unknown> {
  constructor(
    public readonly status?: string,
    public readonly page?: number,
    public readonly take?: number,
    public readonly pageSize?: number,
    public readonly from?: string,
    public readonly to?: string,
    public readonly provider?: string,
    public readonly userId?: string,
    public readonly email?: string,
    public readonly paymentCode?: string,
    public readonly orderId?: string,
  ) {
    super();
  }
}
