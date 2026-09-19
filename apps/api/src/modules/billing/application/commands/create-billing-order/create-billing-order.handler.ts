import { Inject } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import type { AppConfig } from "../../../../../config/config.types.js";
import { BillingPaymentKernel } from "../../shared/billing-payment.kernel.js";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../../domain/repositories/billing-transaction.port.js";
import {
  estimatePrepaid,
  toOrderView,
} from "../../shared/billing-application.helpers.js";
import { CreateBillingOrderCommand } from "./create-billing-order.command.js";

@CommandHandler(CreateBillingOrderCommand)
export class CreateBillingOrderHandler implements ICommandHandler<CreateBillingOrderCommand> {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
    private readonly payments: BillingPaymentKernel,
    private readonly config: ConfigService<AppConfig, true>,
  ) {}

  async execute(command: CreateBillingOrderCommand) {
    const estimate = estimatePrepaid(command.amountVnd);
    const order = await this.payments.createOrder({
      userId: command.userId,
      idempotencyKey: command.idempotencyKey,
      amountMinorUnits: command.amountVnd,
      creditUnits: BigInt(estimate.creditUnits),
      actorId: command.userId,
      sessionId: command.audit.sessionId,
      correlationId: command.audit.correlationId,
    });
    return toOrderView(order, this.config);
  }
}
