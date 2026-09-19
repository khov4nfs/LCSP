import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { listReconciliation } from "../../shared/billing-application.helpers.js";
import { ListBillingReconciliationQuery } from "./list-billing-reconciliation.query.js";

@QueryHandler(ListBillingReconciliationQuery)
export class ListBillingReconciliationHandler implements IQueryHandler<ListBillingReconciliationQuery> {
  constructor(private readonly prisma: PrismaService) {}

  execute(query: ListBillingReconciliationQuery) {
    return listReconciliation(this.prisma, query);
  }
}
