import { QueryHandler } from "@nestjs/cqrs";
import type { IQueryHandler } from "@nestjs/cqrs";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { getRevenueSummary } from "../../shared/billing-admin-reporting.js";
import { GetBillingRevenueSummaryQuery } from "./get-billing-revenue-summary.query.js";

@QueryHandler(GetBillingRevenueSummaryQuery)
export class GetBillingRevenueSummaryHandler implements IQueryHandler<GetBillingRevenueSummaryQuery> {
  constructor(private readonly prisma: PrismaService) {}

  execute(query: GetBillingRevenueSummaryQuery) {
    return getRevenueSummary(this.prisma, query);
  }
}
