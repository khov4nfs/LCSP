import { Query } from "@nestjs/cqrs";

export class ListBillingTransactionsQuery extends Query<unknown> {
  constructor(
    public readonly input: {
      from?: string;
      to?: string;
      status?: string;
      provider?: string;
      userId?: string;
      email?: string;
      paymentCode?: string;
      orderId?: string;
      cursor?: string;
      pageSize?: number;
    },
  ) {
    super();
  }
}
