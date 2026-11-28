import { Query } from "@nestjs/cqrs";
import type { ModelTariffDraftView } from "@lcsp/contracts/billing";

export class GetModelTariffDraftQuery extends Query<ModelTariffDraftView> {
  constructor(public readonly draftId: string) {
    super();
  }
}
