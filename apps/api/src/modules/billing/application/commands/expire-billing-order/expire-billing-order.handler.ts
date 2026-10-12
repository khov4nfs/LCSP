import { Inject } from "@nestjs/common";
import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import {
  BILLING_AUDIT_EVENT_TYPES,
  BILLING_ORDER_STATUSES,
} from "@lcsp/contracts/billing";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../../domain/repositories/billing-transaction.port.js";
import { ExpireBillingOrderCommand } from "./expire-billing-order.command.js";

@CommandHandler(ExpireBillingOrderCommand)
export class ExpireBillingOrderHandler implements ICommandHandler<ExpireBillingOrderCommand> {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
  ) {}

  execute(command: ExpireBillingOrderCommand): Promise<void> {
    return this.transactions.runForUser(
      command.userId,
      async (repositories) => {
        const order = await repositories.order.findForUser(
          command.userId,
          command.orderId,
        );
        if (
          !order ||
          order.status !== BILLING_ORDER_STATUSES.PENDING_PAYMENT ||
          !order.expiresAt ||
          order.expiresAt > new Date()
        )
          return;
        const claimed = await repositories.order.transition(
          order.id,
          BILLING_ORDER_STATUSES.PENDING_PAYMENT,
          BILLING_ORDER_STATUSES.EXPIRED,
        );
        if (claimed) {
          await repositories.audit.append({
            eventType: BILLING_AUDIT_EVENT_TYPES.orderExpired,
            actorId: command.userId,
            sessionId: command.audit.sessionId,
            correlationId: command.audit.correlationId,
            resourceId: order.id,
            payload: { previousStatus: BILLING_ORDER_STATUSES.PENDING_PAYMENT },
          });
        }
      },
    );
  }
}
