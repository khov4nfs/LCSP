import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
  billingAdminReconciliationCaseListQuerySchema,
  billingAdminReconciliationListQuerySchema,
  billingAdminRejectSchema,
  billingAdminResolveSchema,
  billingResourceIdSchema,
  reconciliationCaseDecisionRequestSchema,
  reconciliationNoUsageResolutionRequestSchema,
  type BillingAdminReconciliationCaseListQuery,
  type BillingAdminReconciliationListQuery,
  type BillingAdminRejectRequest,
  type BillingAdminResolveRequest,
  type ReconciliationCaseDecisionRequest,
  type ReconciliationNoUsageResolutionRequest,
} from "@lcsp/contracts/billing";
import type { AuthenticatedRequest } from "../../../../platform/rbac/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../platform/http/pipes/zod-validation.pipe.ts";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RequireActions } from "../../../../platform/rbac/decorators/require-actions.decorator.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import { RejectBillingPaymentCommand } from "../../application/commands/reject-billing-payment/reject-billing-payment.command.js";
import { ResolveBillingPaymentCommand } from "../../application/commands/resolve-billing-payment/resolve-billing-payment.command.js";
import { ResolveBillableInvocationNoUsageCommand } from "../../application/commands/resolve-billable-invocation-no-usage/resolve-billable-invocation-no-usage.command.js";
import type { ResolveNoUsageExecutionResult } from "../../application/commands/resolve-billable-invocation-no-usage/resolve-billable-invocation-no-usage.handler.js";
import { DecideBillingReconciliationCaseCommand } from "../../application/commands/decide-billing-reconciliation-case/decide-billing-reconciliation-case.command.js";
import { GetBillingReconciliationQuery } from "../../application/queries/get-billing-reconciliation/get-billing-reconciliation.query.js";
import { ListBillingReconciliationQuery } from "../../application/queries/list-billing-reconciliation/list-billing-reconciliation.query.js";
import { ListBillingReconciliationCasesQuery } from "../../application/queries/list-billing-reconciliation-cases/list-billing-reconciliation-cases.query.js";
import { GetBillingReconciliationCaseDetailQuery } from "../../application/queries/get-billing-reconciliation-case-detail/get-billing-reconciliation-case-detail.query.js";
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

  /**
   * Business purpose: Admin queue to list and filter BillingReconciliationCase records.
   * Business rules: Only an authenticated Admin may read the case queue; the query must pass the contract schema.
   * Execution flow: 1. Validate filters. 2. Query the queue. 3. Return an enveloped page.
   * Failure cases: Query errors become billing problems carrying the request correlation ID.
   * Side effects: Read-only database query.
   */
  // Rationale ("Why"): ADR-028 Line 155 mandates operational queue for model invocations in DISPATCH_UNKNOWN.
  // Mechanism ("How"): Queries cases with state and provider filtering, returns paginated items.
  // Invariants & Constraints: Protected by RbacGuard and @RequireRoles(admin).
  @Get("cases")
  async listCases(
    @Query(
      new ZodValidationPipe(
        billingAdminReconciliationCaseListQuerySchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    query: BillingAdminReconciliationCaseListQuery,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return resultEnvelope(
        await this.queryBus.execute(
          new ListBillingReconciliationCasesQuery(query),
        ),
      );
    } catch (error) {
      return toBillingAdminProblem(
        error,
        request.correlationId ?? "billing-admin",
      );
    }
  }

  /**
   * Business purpose: Admin detail view to inspect a specific BillingReconciliationCase and linked evidence.
   * Business rules: Only an authenticated Admin may inspect the selected case ID.
   * Execution flow: 1. Validate the case ID. 2. Query linked case evidence. 3. Return an enveloped detail.
   * Failure cases: Missing cases return a billing problem with the request correlation ID.
   * Side effects: Read-only database query.
   */
  // Rationale ("Why"): Admins must inspect full case telemetry and cryptographic provider log artifact before deciding.
  // Mechanism ("How"): Queries case by caseId, joins admission, and loads ProviderLogArtifact.
  // Invariants & Constraints: Fails with 404 BILLING_NOT_FOUND if caseId does not exist.
  @Get("cases/:caseId")
  async getCaseDetail(
    @Param(
      "caseId",
      new ZodValidationPipe(
        billingResourceIdSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    caseId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return resultEnvelope(
        await this.queryBus.execute(
          new GetBillingReconciliationCaseDetailQuery(caseId),
        ),
      );
    } catch (error) {
      return toBillingAdminProblem(
        error,
        request.correlationId ?? "billing-admin",
      );
    }
  }

  /**
   * Business purpose: Audited Admin decision on an open or in-review BillingReconciliationCase.
   */
  // Rationale ("Why"): Closing or altering financial exposure requires verified provider logs and explicit authority.
  // Mechanism ("How"): Validates request body, checks action permission, dispatches command.
  // Invariants & Constraints: Requires explicit billing:reconciliation:decision action permission.
  @Post("cases/:caseId/decide")
  @HttpCode(HttpStatus.OK)
  @RequireActions(BILLING_ACTIONS.reconciliationDecision)
  async decideCase(
    @Param(
      "caseId",
      new ZodValidationPipe(
        billingResourceIdSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    caseId: string,
    @Body(
      new ZodValidationPipe(
        reconciliationCaseDecisionRequestSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: ReconciliationCaseDecisionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return resultEnvelope(
        await this.commandBus.execute(
          new DecideBillingReconciliationCaseCommand(
            caseId,
            body,
            request.rbacContext,
            request.correlationId ?? "billing-admin",
          ),
        ),
      );
    } catch (error) {
      return toBillingAdminProblem(
        error,
        request.correlationId ?? "billing-admin",
      );
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

  /**
   * Business purpose: Admin command to resolve an unknown/disputed model invocation to CONFIRMED_NO_USAGE.
   * Business rules: The caller must be an Admin with explicit reconciliation decision permission; provider evidence is verified by the command handler.
   * Execution flow: 1. Validate the request. 2. Delegate the decision to the handler. 3. Return the standard result envelope.
   * Failure cases: RBAC denies missing action authority; validation or evidence failure prevents slot release.
   * Side effects: The handler may close the reconciliation case and release the admission slot in one transaction.
   */
  // Rationale ("Why"): ADR-028 Line 155 specifies that only audited provider evidence can close exposure.
  // Mechanism ("How"): Validates request body, checks provider capability and log coverage, delegates to command.
  // Invariants & Constraints: Protected by RbacGuard and @RequireRoles(admin).
  @Post("resolve-no-usage")
  @HttpCode(HttpStatus.OK)
  // Why: This older route can release financial exposure just like the case decision route.
  // How: RbacGuard enforces the same action permission before the handler is invoked.
  // Invariant: ADMIN role membership alone cannot close a billable reconciliation case.
  @RequireActions(BILLING_ACTIONS.reconciliationDecision)
  async resolveNoUsage(
    @Body(
      new ZodValidationPipe(
        reconciliationNoUsageResolutionRequestSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: ReconciliationNoUsageResolutionRequest,
    @Req() request: AuthenticatedRequest,
  ) {
    // Why: The command bus defaults to any, which can conceal a broken settlement response contract.
    // How: Bind the handler result type at the transport edge before enveloping it.
    // Invariant: The no-usage route returns only the typed slot-release decision.
    const result = await this.commandBus.execute<
      ResolveBillableInvocationNoUsageCommand,
      ResolveNoUsageExecutionResult
    >(
      new ResolveBillableInvocationNoUsageCommand(
        body,
        request.correlationId ?? "billing-admin",
        request.rbacContext.userId,
      ),
    );

    return resultEnvelope(result);
  }
}
