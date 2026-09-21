import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { PAYMENT_RECONCILIATION_STATUSES } from "@lcsp/contracts/billing";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { RejectBillingPaymentCommand } from "../../application/commands/reject-billing-payment/reject-billing-payment.command.js";
import { ResolveBillingPaymentCommand } from "../../application/commands/resolve-billing-payment/resolve-billing-payment.command.js";
import { GetBillingReconciliationQuery } from "../../application/queries/get-billing-reconciliation/get-billing-reconciliation.query.js";
import { ListBillingReconciliationQuery } from "../../application/queries/list-billing-reconciliation/list-billing-reconciliation.query.js";
import { toBillingAdminProblem } from "./errors/billing-admin.error-mapper.js";

@Controller("admin/billing/reconciliation")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class BillingAdminReconciliationController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  async list(
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("take") take?: string,
    @Query("pageSize") pageSize?: string,
    @Query("page_size") pageSizeAlias?: string,
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("provider") provider?: string,
    @Query("userId") userId?: string,
    @Query("email") email?: string,
    @Query("paymentCode") paymentCode?: string,
    @Query("orderId") orderId?: string,
  ) {
    try {
      return resultEnvelope(
        await this.queryBus.execute(
          new ListBillingReconciliationQuery(
            status,
            page ? Number(page) : undefined,
            take ? Number(take) : undefined,
            pageSize
              ? Number(pageSize)
              : pageSizeAlias
                ? Number(pageSizeAlias)
                : undefined,
            from,
            to,
            provider,
            userId,
            email,
            paymentCode,
            orderId,
          ),
        ),
      );
    } catch (error) {
      return toBillingAdminProblem(error, "billing-admin");
    }
  }

  @Get(":paymentId")
  async get(@Param("paymentId") paymentId: string) {
    try {
      return resultEnvelope(
        await this.queryBus.execute(
          new GetBillingReconciliationQuery(paymentId),
        ),
      );
    } catch (error) {
      return toBillingAdminProblem(error, "billing-admin");
    }
  }

  @Patch(":paymentId/resolve")
  async resolve(
    @Param("paymentId") paymentId: string,
    @Body()
    body: {
      billingOrderId?: string;
      expectedVersion?: number;
      rationale?: string;
    },
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return resultEnvelope(
        await this.commandBus.execute(
          new ResolveBillingPaymentCommand({
            paymentId,
            billingOrderId: body.billingOrderId ?? "",
            expectedVersion: body.expectedVersion ?? -1,
            rationale: body.rationale ?? "",
            actorId: request.rbacContext.userId,
            correlationId: request.correlationId ?? "billing-admin",
          }),
        ),
      );
    } catch (error) {
      return toBillingAdminProblem(
        error,
        request.correlationId ?? "billing-admin",
      );
    }
  }

  @Patch(":paymentId/reject")
  async reject(
    @Param("paymentId") paymentId: string,
    @Body()
    body: {
      expectedStatus?: string;
      expectedVersion?: number;
      rationale?: string;
    },
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return resultEnvelope(
        await this.commandBus.execute(
          new RejectBillingPaymentCommand({
            paymentId,
            expectedStatus:
              body.expectedStatus ??
              PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW,
            expectedVersion: body.expectedVersion ?? -1,
            rationale: body.rationale ?? "",
            actorId: request.rbacContext.userId,
            correlationId: request.correlationId ?? "billing-admin",
          }),
        ),
      );
    } catch (error) {
      return toBillingAdminProblem(
        error,
        request.correlationId ?? "billing-admin",
      );
    }
  }
}
