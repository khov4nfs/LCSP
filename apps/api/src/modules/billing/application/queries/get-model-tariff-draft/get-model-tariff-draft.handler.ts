import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import type { ModelTariffDraftView } from "@lcsp/contracts/billing";
import { ModelPricingNotFoundError } from "../../../domain/billing.errors.js";
import {
  MODEL_PRICING_REPOSITORY,
  type ModelPricingRepositoryPort,
} from "../../../domain/repositories/model-pricing.port.js";
import { toModelTariffDraftView } from "../../mappers/model-pricing-view.mapper.js";
import { GetModelTariffDraftQuery } from "./get-model-tariff-draft.query.js";

@QueryHandler(GetModelTariffDraftQuery)
export class GetModelTariffDraftHandler implements IQueryHandler<GetModelTariffDraftQuery> {
  constructor(
    @Inject(MODEL_PRICING_REPOSITORY)
    private readonly repo: ModelPricingRepositoryPort,
  ) {}

  /**
   * Business purpose: Load a single mutable `CustomerModelTariffDraft` record and project it into its Admin wire view.
   *
   * Business rules:
   * - Throws `ModelPricingNotFoundError` when the requested draft identifier does not exist.
   *
   * Execution flow:
   * 1. Query the draft via `repo.findDraftById`.
   * 2. Throw `ModelPricingNotFoundError` if missing, otherwise map via `toModelTariffDraftView`.
   *
   * Failure cases:
   * - Throws `ModelPricingNotFoundError` (404) when missing.
   *
   * Side effects:
   * - None: read-only query.
   */
  async execute(
    query: GetModelTariffDraftQuery,
  ): Promise<ModelTariffDraftView> {
    // Why: Admin pricing inspection requires retrieving individual draft details before editing or publishing.
    // How: Looks up draft by ID through repository port and converts BigInt/Date fields into DTO wire formats.
    // Invariants: Read-only operation with zero state mutation.
    const draft = await this.repo.findDraftById(query.draftId);
    if (!draft) {
      throw new ModelPricingNotFoundError(
        `Model tariff draft '${query.draftId}' was not found`,
      );
    }
    return toModelTariffDraftView(draft);
  }
}
