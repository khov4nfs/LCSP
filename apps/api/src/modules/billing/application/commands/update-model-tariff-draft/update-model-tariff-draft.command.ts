import { Command } from "@nestjs/cqrs";
import type {
  ModelTariffDraftView,
  UpdateModelTariffDraftInput,
} from "@lcsp/contracts/billing";

export type UpdateModelTariffDraftCommandInput = UpdateModelTariffDraftInput & {
  draftId: string;
  actorId: string;
  correlationId: string;
};

export class UpdateModelTariffDraftCommand extends Command<ModelTariffDraftView> {
  constructor(public readonly input: UpdateModelTariffDraftCommandInput) {
    super();
  }
}
