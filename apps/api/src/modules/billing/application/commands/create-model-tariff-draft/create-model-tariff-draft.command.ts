import { Command } from "@nestjs/cqrs";
import type {
  CreateModelTariffDraftInput,
  ModelTariffDraftView,
} from "@lcsp/contracts/billing";

export type CreateModelTariffDraftCommandInput = CreateModelTariffDraftInput & {
  actorId: string;
  correlationId: string;
};

export class CreateModelTariffDraftCommand extends Command<ModelTariffDraftView> {
  constructor(public readonly input: CreateModelTariffDraftCommandInput) {
    super();
  }
}
