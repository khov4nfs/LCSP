import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UseGuards,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  BILLING_ACTIONS,
  BILLING_ERROR_CODES,
  billingAdminDashboardQuerySchema,
  billingAdminExportQuerySchema,
  compensateBillingDebitRequestSchema,
  type BillingAdminDashboardQuery,
  type BillingAdminExportQuery,
  type CompensateBillingDebitRequest,
} from "@lcsp/contracts/billing";
import { ZodValidationPipe } from "../../../../platform/http/pipes/zod-validation.pipe.ts";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RequireActions } from "../../../../platform/rbac/decorators/require-actions.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import type { AuthenticatedRequest } from "../../../../platform/rbac/interfaces/authenticated-request.interface.js";
import { GetBillingAdminDashboardQuery } from "../../application/queries/get-admin-billing-dashboard/get-admin-billing-dashboard.query.js";
import { GetBillingAdminExportQuery } from "../../application/queries/get-admin-billing-export/get-admin-billing-export.query.js";
import { CompensateBillingDebitCommand } from "../../application/commands/compensate-billing-debit/compensate-billing-debit.command.js";

@Controller("admin/billing")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class BillingAdminController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  async getDashboard(
    @Query(
      new ZodValidationPipe(
        billingAdminDashboardQuerySchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    query: BillingAdminDashboardQuery,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(new GetBillingAdminDashboardQuery(query)),
    );
  }

  @Get("export")
  async exportReport(
    @Query(
      new ZodValidationPipe(
        billingAdminExportQuerySchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    query: BillingAdminExportQuery,
  ) {
    return resultEnvelope(
      await this.queryBus.execute(new GetBillingAdminExportQuery(query)),
    );
  }

  /**
   * Business purpose: Issue a bounded, immutable compensation for an eligible model usage debit.
   *
   * Business rules:
   * - Caller must possess admin role and compensation action permission.
   * - Request payload must strictly match contract (unknown fields rejected).
   * - Delegates to CompensateBillingDebitCommand for atomic ledger, projection, audit, and outbox write.
   *
   * Execution flow:
   * 1. Validate payload using strict Zod schema.
   * 2. Forward to CommandBus with caller rbacContext and correlationId.
   * 3. Return envelope-wrapped CompensateBillingDebitResponse.
   *
   * Failure cases:
   * - 400 validation error if payload contains unknown fields or invalid amounts.
   * - 403 if caller lacks admin role or action permission.
   *
   * Side effects:
   * - Appends CreditLedgerEntry, updates BillingWallet, writes AuditEvent and OutboxMessage.
   */
  @Post("compensate")
  @RequireRoles(AUTH_USER_ROLES.admin)
  @RequireActions(BILLING_ACTIONS.compensation)
  @HttpCode(HttpStatus.OK)
  async compensateDebit(
    @Body(
      new ZodValidationPipe(
        compensateBillingDebitRequestSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: CompensateBillingDebitRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    const result = await this.commandBus.execute(
      new CompensateBillingDebitCommand(
        body,
        request.rbacContext,
        request.correlationId ?? "billing-compensation",
      ),
    );
    return resultEnvelope(result);
  }
}
