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
import {
  BILLING_ERROR_CODES,
  BILLING_ORDER_STATUSES,
  billingAmountVndSchema,
  billingCreateOrderSchema,
  billingHistoryQuerySchema,
  billingIdempotencyKeySchema,
  billingResourceIdSchema,
  type BillingCreateOrderInput,
  type BillingHistoryQueryInput,
  type BillingOrderView,
} from "@lcsp/contracts/billing";
import { RequireRoles } from "../../../../platform/rbac/decorators/require-roles.decorator.js";
import { RbacGuard } from "../../../../platform/rbac/rbac.guard.js";
import { resultEnvelope } from "../../../../platform/http/filters/error.factory.js";
import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { ZodValidationPipe } from "../../../../common/pipes/zod-validation.pipe.ts";
import { EstimateBillingQuery } from "../../application/queries/estimate-billing/estimate-billing.query.js";
import { CreateBillingOrderCommand } from "../../application/commands/create-billing-order/create-billing-order.command.js";
import { ExpireBillingOrderCommand } from "../../application/commands/expire-billing-order/expire-billing-order.command.js";
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
    @Query(
      "amount_vnd",
      new ZodValidationPipe(
        billingAmountVndSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    amount: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      return resultEnvelope(
        await this.queryBus.execute(
          new EstimateBillingQuery(
            request.rbacContext.userId,
            parseAmount(amount),
          ),
        ),
      );
    } catch (error) {
      throw mapBillingError(error, request);
    }
  }

  @Post("orders")
  async order(
    @Body(
      new ZodValidationPipe(
        billingCreateOrderSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    body: BillingCreateOrderInput,
    @Headers("idempotency-key") key: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const keyResult = billingIdempotencyKeySchema.safeParse(key);
    if (!keyResult.success)
      throw mapBillingError(
        new Error(BILLING_ERROR_CODES.idempotencyKeyRequired),
        request,
      );
    try {
      return resultEnvelope(
        await this.commandBus.execute(
          new CreateBillingOrderCommand(
            request.rbacContext.userId,
            parseAmount(body.amount_vnd),
            keyResult.data,
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
    @Param(
      "id",
      new ZodValidationPipe(
        billingResourceIdSchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    id: string,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const userId = request.rbacContext.userId;
      const audit = {
        correlationId: request.correlationId ?? "billing-order-read",
        sessionId: request.rbacContext.sessionId,
      };
      const query = new GetBillingOrderQuery(userId, id);
      let order = await this.queryBus.execute(query);
      if (isOrderDue(order, new Date())) {
        await this.commandBus.execute(
          new ExpireBillingOrderCommand(userId, id, audit),
        );
        order = await this.queryBus.execute(query);
      }
      return resultEnvelope(order);
    } catch (error) {
      throw mapBillingError(error, request);
    }
  }

  @Get("history")
  async history(
    @Query(
      new ZodValidationPipe(
        billingHistoryQuerySchema,
        BILLING_ERROR_CODES.validationFailed,
      ),
    )
    query: BillingHistoryQueryInput,
    @Req() request: AuthenticatedRequest,
  ) {
    try {
      const userId = request.rbacContext.userId;
      const audit = {
        correlationId: request.correlationId ?? "billing-history",
        sessionId: request.rbacContext.sessionId,
      };
      const historyQuery = new ListBillingHistoryQuery(
        userId,
        query.page,
        query.page_size,
      );
      let history = await this.queryBus.execute(historyQuery);
      const dueOrders = history.orders.filter((order) =>
        isOrderDue(order, new Date()),
      );
      if (dueOrders.length > 0) {
        await Promise.all(
          dueOrders.map((order) =>
            this.commandBus.execute(
              new ExpireBillingOrderCommand(userId, order.id, audit),
            ),
          ),
        );
        history = await this.queryBus.execute(historyQuery);
      }
      return resultEnvelope(history);
    } catch (error) {
      throw mapBillingError(error, request);
    }
  }
}

function isOrderDue(order: BillingOrderView, now: Date): boolean {
  return (
    order.status === BILLING_ORDER_STATUSES.PENDING_PAYMENT &&
    order.expiresAt !== null &&
    new Date(order.expiresAt) <= now
  );
}
