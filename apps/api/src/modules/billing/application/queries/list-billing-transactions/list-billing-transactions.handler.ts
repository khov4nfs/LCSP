import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { listAdminTransactions } from "../../shared/billing-admin-reporting.js";
import { ListBillingTransactionsQuery } from "./list-billing-transactions.query.js";

@QueryHandler(ListBillingTransactionsQuery)
export class ListBillingTransactionsHandler implements IQueryHandler<ListBillingTransactionsQuery> {
  constructor(private readonly prisma: PrismaService) {}

  execute(query: ListBillingTransactionsQuery) {
    return listAdminTransactions(this.prisma, query.input);
  }
}
