import { Inject } from "@nestjs/common";
import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import { BillingAccountingKernel } from "../../shared/billing-accounting.kernel.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import {
  BILLING_TRANSACTION_PORT,
  type BillingTransactionPort,
} from "../../../domain/repositories/billing-transaction.port.js";
import { resolvePayment } from "../../shared/billing-application.helpers.js";
import { ResolveBillingPaymentCommand } from "./resolve-billing-payment.command.js";

@CommandHandler(ResolveBillingPaymentCommand)
export class ResolveBillingPaymentHandler implements ICommandHandler<ResolveBillingPaymentCommand> {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(BILLING_TRANSACTION_PORT)
    private readonly transactions: BillingTransactionPort,
    private readonly accounting: BillingAccountingKernel,
  ) {}

  execute(command: ResolveBillingPaymentCommand) {
    return resolvePayment(
      command.input,
      this.prisma,
      this.transactions,
      this.accounting,
    );
  }
}
