import { Inject } from "@nestjs/common";
import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../../domain/repositories/billing-transaction.port.js";
import { rejectPayment } from "../../shared/billing-application.helpers.js";
import { RejectBillingPaymentCommand } from "./reject-billing-payment.command.js";

@CommandHandler(RejectBillingPaymentCommand)
export class RejectBillingPaymentHandler implements ICommandHandler<RejectBillingPaymentCommand> {
  constructor(
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
  ) {}

  execute(command: RejectBillingPaymentCommand) {
    return rejectPayment(command.input, this.transactions);
  }
}
