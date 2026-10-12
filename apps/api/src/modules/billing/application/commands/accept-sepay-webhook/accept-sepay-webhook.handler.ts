import { CommandHandler } from "@nestjs/cqrs";
import type { ICommandHandler } from "@nestjs/cqrs";
import { SePayWebhookIngress } from "../../../infrastructure/security/sepay-webhook-ingress.js";
import { AcceptSePayWebhookCommand } from "./accept-sepay-webhook.command.js";

@CommandHandler(AcceptSePayWebhookCommand)
export class AcceptSePayWebhookHandler implements ICommandHandler<AcceptSePayWebhookCommand> {
  constructor(private readonly ingress: SePayWebhookIngress) {}

  execute(command: AcceptSePayWebhookCommand) {
    return this.ingress.accept(command.input);
  }
}
