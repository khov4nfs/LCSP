import { Command } from "@nestjs/cqrs";

export class ReconcileAcceptedSePayWebhookCommand extends Command<unknown> {
  constructor(public readonly eventId: string) {
    super();
  }
}
