import { Query } from "@nestjs/cqrs";
import type {
  PreviewModelPricingInput,
  PreviewModelPricingResponse,
} from "@lcsp/contracts/billing";

export class PreviewModelPricingQuery extends Query<PreviewModelPricingResponse> {
  constructor(public readonly input: PreviewModelPricingInput) {
    super();
  }
}
