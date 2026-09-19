import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { getReconciliation } from "../../shared/billing-application.helpers.js";
import { GetBillingReconciliationQuery } from "./get-billing-reconciliation.query.js";

@QueryHandler(GetBillingReconciliationQuery)
export class GetBillingReconciliationHandler implements IQueryHandler<GetBillingReconciliationQuery> {
  constructor(private readonly prisma: PrismaService) {}

  execute(query: GetBillingReconciliationQuery) {
    return getReconciliation(this.prisma, query.paymentId);
  }
}
