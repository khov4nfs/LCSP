import { Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import { BillingOrderNotFoundError } from "../../../domain/billing.errors.js";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../../domain/repositories/billing-transaction.port.js";
import { toBillingOrderView } from "../../mappers/billing-order.mapper.js";
import type { AppConfig } from "../../../../../config/config.types.js";
import { GetBillingOrderQuery } from "./get-billing-order.query.js";

@QueryHandler(GetBillingOrderQuery)
export class GetBillingOrderHandler implements IQueryHandler<GetBillingOrderQuery> {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async execute(query: GetBillingOrderQuery) {
    const order = await this.transactions.runForUser(query.userId, (r) =>
      r.order.findForUser(query.userId, query.orderId),
    );
    if (!order) throw new BillingOrderNotFoundError("Billing order not found");
    return toBillingOrderView(order, this.config);
  }
}
