import { Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import type { BillingHistoryView } from "@lcsp/contracts/billing";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../../domain/repositories/billing-transaction.port.js";
import { toBillingOrderView } from "../../mappers/billing-order.mapper.js";
import type { AppConfig } from "../../../../../config/config.types.js";
import { ListBillingHistoryQuery } from "./list-billing-history.query.js";

@QueryHandler(ListBillingHistoryQuery)
export class ListBillingHistoryHandler implements IQueryHandler<ListBillingHistoryQuery> {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async execute(query: ListBillingHistoryQuery) {
    const page =
      Number.isInteger(query.page) && query.page > 0 ? query.page : 1;
    const pageSize =
      Number.isInteger(query.pageSize) && query.pageSize > 0
        ? Math.min(query.pageSize, 100)
        : 20;
    const result = await this.transactions.runForUser(query.userId, (r) =>
      r.order.listForUser({
        userId: query.userId,
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    );
    return {
      orders: result.orders.map((order) =>
        toBillingOrderView(order, this.config),
      ),
      page,
      pageSize,
      totalCount: result.totalCount,
    } satisfies BillingHistoryView;
  }
}
