import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import { BillingPaymentKernel } from "../../shared/billing-payment.kernel.js";
import { ReconcileAcceptedSePayWebhookCommand } from "./reconcile-accepted-sepay-webhook.command.js";

@CommandHandler(ReconcileAcceptedSePayWebhookCommand)
export class ReconcileAcceptedSePayWebhookHandler implements ICommandHandler<ReconcileAcceptedSePayWebhookCommand> {
  constructor(private readonly payments: BillingPaymentKernel) {}

  execute(command: ReconcileAcceptedSePayWebhookCommand) {
    return this.payments.reconcileAcceptedWebhook(command.eventId);
  }
}
