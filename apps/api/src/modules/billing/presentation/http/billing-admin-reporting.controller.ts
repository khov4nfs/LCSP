import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { GetBillingRevenueSummaryQuery } from "../../application/queries/get-billing-revenue-summary/get-billing-revenue-summary.query.js";
import { ListBillingTransactionsQuery } from "../../application/queries/list-billing-transactions/list-billing-transactions.query.js";
import { toBillingAdminProblem } from "./errors/billing-admin.error-mapper.js";

@Controller("admin/billing")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class BillingAdminReportingController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get("revenue-summary")
  async revenueSummary(@Query("from") from?: string, @Query("to") to?: string) {
    try {
      return resultEnvelope(
        await this.queryBus.execute(
          new GetBillingRevenueSummaryQuery(from, to),
        ),
      );
    } catch (error) {
      return toBillingAdminProblem(error, "billing-admin");
    }
  }

  @Get("transactions")
  async transactions(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("status") status?: string,
    @Query("provider") provider?: string,
    @Query("userId") userId?: string,
    @Query("email") email?: string,
    @Query("paymentCode") paymentCode?: string,
    @Query("orderId") orderId?: string,
    @Query("cursor") cursor?: string,
    @Query("pageSize") pageSize?: string,
    @Query("page_size") pageSizeAlias?: string,
  ) {
    try {
      return resultEnvelope(
        await this.queryBus.execute(
          new ListBillingTransactionsQuery({
            from,
            to,
            status,
            provider,
            userId,
            email,
            paymentCode,
            orderId,
            cursor,
            pageSize: Number(pageSize ?? pageSizeAlias) || undefined,
          }),
        ),
      );
    } catch (error) {
      return toBillingAdminProblem(error, "billing-admin");
    }
  }
}
