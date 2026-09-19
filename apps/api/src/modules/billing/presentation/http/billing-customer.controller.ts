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
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { AUTH_USER_ROLES } from "@lcsp/contracts/auth";
import { BILLING_ERROR_CODES } from "@lcsp/contracts/billing";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { CreateBillingOrderCommand } from "../../application/commands/create-billing-order/create-billing-order.command.js";
import { EstimateBillingQuery } from "../../application/queries/estimate-billing/estimate-billing.query.js";
import { GetBillingOrderQuery } from "../../application/queries/get-billing-order/get-billing-order.query.js";
import { GetBillingWalletQuery } from "../../application/queries/get-billing-wallet/get-billing-wallet.query.js";
import { ListBillingHistoryQuery } from "../../application/queries/list-billing-history/list-billing-history.query.js";
import {
  mapBillingError,
  parseAmount,
} from "./errors/billing-http.error-mapper.js";

@Controller("billing")
@UseGuards(RbacGuard)
@RequireRoles(AUTH_USER_ROLES.customer)
export class BillingCustomerController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get("wallet")
  wallet(@Req() request: AuthenticatedRequest) {
    return this.queryBus
      .execute(new GetBillingWalletQuery(request.rbacContext.userId))
      .then(resultEnvelope);
  }

  @Get("estimate")
  async estimate(
    @Query("amount_vnd") amount: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return resultEnvelope(
        await this.queryBus.execute(
          new EstimateBillingQuery(parseAmount(amount)),
        ),
      );
    } catch (error) {
      throw mapBillingError(error, request);
    }
  }

  @Post("orders")
  async order(
    @Body() body: unknown,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    if (!key?.trim())
      throw mapBillingError(
        new Error(BILLING_ERROR_CODES.idempotencyKeyRequired),
        request,
      );
    const amount =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as { amount_vnd?: unknown }).amount_vnd
        : undefined;
    try {
      return resultEnvelope(
        await this.commandBus.execute(
          new CreateBillingOrderCommand(
            request.rbacContext.userId,
            parseAmount(amount),
            key,
            {
              correlationId: request.correlationId ?? "billing-order",
              sessionId: request.rbacContext.sessionId,
            },
          ),
        ),
      );
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
      return resultEnvelope(
        await this.queryBus.execute(
          new GetBillingOrderQuery(request.rbacContext.userId, id, {
            correlationId: request.correlationId ?? "billing-order-read",
            sessionId: request.rbacContext.sessionId,
          }),
        ),
      );
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
      return resultEnvelope(
        await this.queryBus.execute(
          new ListBillingHistoryQuery(
            request.rbacContext.userId,
            Number(page ?? 1),
            Number(pageSize ?? 20),
            {
              correlationId: request.correlationId ?? "billing-history",
              sessionId: request.rbacContext.sessionId,
            },
          ),
        ),
      );
    } catch (error) {
      throw mapBillingError(error, request);
    }
  }
}
