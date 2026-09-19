import { Command } from "@nestjs/cqrs";
import type { SePayWebhookInput } from "../billing-usage.types.js";

export class AcceptSePayWebhookCommand extends Command<{ duplicate: boolean }> {
  constructor(public readonly input: SePayWebhookInput) {
    super();
  }
}
