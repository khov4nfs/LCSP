import { Command } from "@nestjs/cqrs";
import type {
  PublishModelTariffDraftInput,
  PublishModelTariffDraftResponse,
} from "@lcsp/contracts/billing";

export type PublishModelTariffDraftCommandInput =
  PublishModelTariffDraftInput & {
    draftId: string;
    actorId: string;
    correlationId: string;
  };

export class PublishModelTariffDraftCommand extends Command<PublishModelTariffDraftResponse> {
  constructor(public readonly input: PublishModelTariffDraftCommandInput) {
    super();
  }
}
