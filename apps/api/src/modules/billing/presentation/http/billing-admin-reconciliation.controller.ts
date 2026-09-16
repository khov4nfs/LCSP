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
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import {
  BILLING_RECONCILIATION_ERROR_CODES,
  PAYMENT_RECONCILIATION_STATUSES,
} from "@lcsp/contracts/billing";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { BillingAdminReconciliationService } from "../../application/services/billing-admin-reconciliation.service.js";

@Controller("admin/billing/reconciliation")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.admin)
export class BillingAdminReconciliationController {
  constructor(private readonly service: BillingAdminReconciliationService) {}

  @Get()
  async list(
    @Query("status") status?: string,
    @Query("page") page?: string,
    @Query("take") take?: string,
  ) {
    try {
      return resultEnvelope(
        await this.service.list({
          status,
          page: page ? Number(page) : undefined,
          take: take ? Number(take) : undefined,
        }),
      );
    } catch (error) {
      toBillingAdminProblem(error, "billing-admin");
    }
  }

  @Get(":paymentId")
  async get(@Param("paymentId") paymentId: string) {
    try {
      return resultEnvelope(await this.service.get(paymentId));
    } catch (error) {
      toBillingAdminProblem(error, "billing-admin");
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
    const correlationId = request.correlationId ?? "billing-admin";
    try {
      return resultEnvelope(
        await this.service.resolve({
          paymentId,
          billingOrderId: body.billingOrderId ?? "",
          expectedVersion: body.expectedVersion ?? -1,
          rationale: body.rationale ?? "",
          actorId: request.rbacContext.userId,
          correlationId,
        }),
      );
    } catch (error) {
      toBillingAdminProblem(error, correlationId);
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
    const correlationId = request.correlationId ?? "billing-admin";
    try {
      return resultEnvelope(
        await this.service.reject({
          paymentId,
          expectedStatus:
            body.expectedStatus ?? PAYMENT_RECONCILIATION_STATUSES.NEEDS_REVIEW,
          expectedVersion: body.expectedVersion ?? -1,
          rationale: body.rationale ?? "",
          actorId: request.rbacContext.userId,
          correlationId,
        }),
      );
    } catch (error) {
      toBillingAdminProblem(error, correlationId);
    }
  }
}

function toBillingAdminProblem(error: unknown, correlationId: string): never {
  const code = error instanceof Error ? error.message : "INTERNAL_ERROR";
  const mapped =
    code === "PAYMENT_NOT_FOUND"
      ? ([BILLING_RECONCILIATION_ERROR_CODES.paymentNotFound, 404] as const)
      : code === "RATIONALE_REQUIRED"
        ? ([BILLING_RECONCILIATION_ERROR_CODES.rationaleRequired, 400] as const)
        : code === "BILLING_RECONCILIATION_OWNERSHIP_CONFLICT"
          ? ([
              BILLING_RECONCILIATION_ERROR_CODES.ownershipConflict,
              409,
            ] as const)
          : code === "BILLING_ORDER_NOT_ELIGIBLE"
            ? ([
                BILLING_RECONCILIATION_ERROR_CODES.orderNotEligible,
                409,
              ] as const)
            : code === "BILLING_AMOUNT_MISMATCH"
              ? ([
                  BILLING_RECONCILIATION_ERROR_CODES.amountMismatch,
                  422,
                ] as const)
              : code === "RECONCILIATION_VERSION_CONFLICT" ||
                  code === "BILLING_ORDER_STATE_CONFLICT"
                ? ([
                    BILLING_RECONCILIATION_ERROR_CODES.staleDecision,
                    409,
                  ] as const)
                : null;
  if (!mapped) {
    if (error instanceof Error) throw error;
    throw new Error("INTERNAL_ERROR", { cause: error });
  }
  throw problemException(mapped[0], correlationId, {
    status: mapped[1],
  });
}
