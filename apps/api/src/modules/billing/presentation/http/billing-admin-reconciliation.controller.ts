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
import {
  BILLING_ERROR_CODES,
  billingAdminReconciliationListQuerySchema,
  billingAdminRejectSchema,
  billingAdminResolveSchema,
  billingResourceIdSchema,
  type BillingAdminReconciliationListQuery,
  type BillingAdminRejectRequest,
  type BillingAdminResolveRequest,
} from "@lcsp/contracts/billing";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.ts";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
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
    @Query(
      new ZodValidationPipe(
        billingAdminReconciliationListQuerySchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    query: BillingAdminReconciliationListQuery,
  ) {
    try {
      return resultEnvelope(
        await this.queryBus.execute(
          new ListBillingReconciliationQuery(
            query.status,
            query.page,
            query.take,
            query.pageSize ?? query.page_size,
            query.from,
            query.to,
            query.provider,
            query.userId,
            query.email,
            query.paymentCode,
            query.orderId,
          ),
        ),
      );
    } catch (error) {
      return toBillingAdminProblem(error, "billing-admin");
    }
  }

  @Get(":paymentId")
  async get(
    @Param(
      "paymentId",
      new ZodValidationPipe(
        billingResourceIdSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    paymentId: string,
  ) {
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
    @Param(
      "paymentId",
      new ZodValidationPipe(
        billingResourceIdSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    paymentId: string,
    @Body(
      new ZodValidationPipe(
        billingAdminResolveSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: BillingAdminResolveRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return resultEnvelope(
        await this.commandBus.execute(
          new ResolveBillingPaymentCommand({
            paymentId,
            billingOrderId: body.billingOrderId,
            expectedVersion: body.expectedVersion,
            rationale: body.rationale,
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
    @Param(
      "paymentId",
      new ZodValidationPipe(
        billingResourceIdSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    paymentId: string,
    @Body(
      new ZodValidationPipe(
        billingAdminRejectSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: BillingAdminRejectRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return resultEnvelope(
        await this.commandBus.execute(
          new RejectBillingPaymentCommand({
            paymentId,
            expectedStatus: body.expectedStatus,
            expectedVersion: body.expectedVersion,
            rationale: body.rationale,
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
