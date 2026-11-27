import { Inject } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import type { ModelTariffSnapshotView } from "@lcsp/contracts/billing";
import { ModelPricingNotFoundError } from "../../../domain/billing.errors.js";
import {
  MODEL_PRICING_REPOSITORY,
  type ModelPricingRepositoryPort,
} from "../../../domain/repositories/model-pricing.port.js";
import { toModelTariffSnapshotView } from "../../mappers/model-pricing-view.mapper.js";
import { GetModelTariffSnapshotQuery } from "./get-model-tariff-snapshot.query.js";

@QueryHandler(GetModelTariffSnapshotQuery)
export class GetModelTariffSnapshotHandler implements IQueryHandler<GetModelTariffSnapshotQuery> {
  constructor(
    @Inject(MODEL_PRICING_REPOSITORY)
    private readonly repo: ModelPricingRepositoryPort,
  ) {}

  /**
   * Business purpose: Load an immutable published `CustomerModelTariffSnapshot` record and project it into its Admin wire view.
   *
   * Business rules:
   * - Throws `ModelPricingNotFoundError` when the requested snapshot identifier does not exist.
   *
   * Execution flow:
   * 1. Query the snapshot via `repo.findSnapshotById`.
   * 2. Throw `ModelPricingNotFoundError` if missing, otherwise map via `toModelTariffSnapshotView`.
   *
   * Failure cases:
   * - Throws `ModelPricingNotFoundError` (404) when missing.
   *
   * Side effects:
   * - None: read-only query.
   */
  async execute(
    query: GetModelTariffSnapshotQuery,
  ): Promise<ModelTariffSnapshotView> {
    // Why: Audit reviewers and admins need direct read-only inspection of immutable historical tariff snapshots.
    // How: Looks up snapshot by ID through repository port and converts BigInt/Date fields into DTO wire formats.
    // Invariants: Read-only operation; snapshots are immutable.
    const snapshot = await this.repo.findSnapshotById(query.snapshotId);
    if (!snapshot) {
      throw new ModelPricingNotFoundError(
        `Model tariff snapshot '${query.snapshotId}' was not found`,
      );
    }
    return toModelTariffSnapshotView(snapshot);
  }
}
