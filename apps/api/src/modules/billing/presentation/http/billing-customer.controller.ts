import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
  HttpStatus,
} from "@nestjs/common";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { BillingCustomerService } from "../../application/services/billing-customer.service.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import {
  BillingIdempotencyConflictError,
  BillingOrderNotFoundError,
  InvalidBillingInputError,
} from "../../domain/billing.errors.js";

@Controller("billing")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer)
export class BillingCustomerController {
  constructor(private readonly billing: BillingCustomerService) {}

  @Get("wallet")
  wallet(@Req() request: AuthenticatedRequest) {
    return this.billing
      .getWallet(request.rbacContext.userId)
      .then(resultEnvelope);
  }

  @Get("estimate")
  estimate(
    @Query("amount_vnd") amount: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return resultEnvelope(this.billing.estimate(parseAmount(amount)));
    } catch {
      throw problemException(
        BILLING_ERROR_CODES.validationFailed,
        request.correlationId ?? "billing-estimate",
        { status: HttpStatus.BAD_REQUEST },
      );
    }
  }

  @Post("orders")
  async order(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!key?.trim())
      throw problemException(
        BILLING_ERROR_CODES.idempotencyKeyRequired,
        request.correlationId ?? "billing-order",
        { status: HttpStatus.BAD_REQUEST },
      );
    const amount =
      body && typeof body === "object"
        ? (body as { amount_vnd?: unknown }).amount_vnd
        : undefined;
    try {
      return await this.billing
        .createOrder(request.rbacContext.userId, parseAmount(amount), key, {
          correlationId: request.correlationId ?? "billing-order",
          sessionId: request.rbacContext.sessionId,
        })
        .then(resultEnvelope);
    } catch (error) {
      throw mapBillingError(error, request);
    }
  }

  @Get("orders/:id")
  async orderDetail(
    @Param("id") id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return await this.billing
        .getOrder(request.rbacContext.userId, id, {
          correlationId: request.correlationId ?? "billing-order-read",
          sessionId: request.rbacContext.sessionId,
        })
        .then(resultEnvelope);
    } catch (error) {
      throw mapBillingError(error, request);
    }
  }

  @Get("history")
  async history(
    @Query("page") page: string | undefined,
    @Query("page_size") pageSize: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return await this.billing
        .listHistory(
          request.rbacContext.userId,
          Number(page ?? 1),
          Number(pageSize ?? 20),
          {
            correlationId: request.correlationId ?? "billing-history",
            sessionId: request.rbacContext.sessionId,
          },
        )
        .then(resultEnvelope);
    } catch (error) {
      throw mapBillingError(error, request);
    }
  }
}

function parseAmount(value: unknown): bigint {
  if (typeof value === "bigint") return value;
  if (typeof value !== "string" && typeof value !== "number")
    throw problemException(
      BILLING_ERROR_CODES.validationFailed,
      "billing-request",
      { status: HttpStatus.BAD_REQUEST },
    );
  if (!/^\d+$/.test(String(value)))
    throw problemException(
      BILLING_ERROR_CODES.validationFailed,
      "billing-request",
      { status: HttpStatus.BAD_REQUEST },
    );
  return BigInt(String(value));
}

function mapBillingError(error: unknown, request: AuthenticatedRequest) {
  const correlationId = request.correlationId ?? "billing-request";
  if (error instanceof BillingIdempotencyConflictError)
    return problemException(
      BILLING_ERROR_CODES.idempotencyConflict,
      correlationId,
      { status: HttpStatus.CONFLICT },
    );
  if (error instanceof InvalidBillingInputError)
    return problemException(
      BILLING_ERROR_CODES.validationFailed,
      correlationId,
      {
        status: HttpStatus.BAD_REQUEST,
      },
    );
  if (error instanceof BillingOrderNotFoundError)
    return problemException(BILLING_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  return error;
}
