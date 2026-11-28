import { Query } from "@nestjs/cqrs";
import type { ModelTariffSnapshotView } from "@lcsp/contracts/billing";

export class GetModelTariffSnapshotQuery extends Query<ModelTariffSnapshotView> {
  constructor(public readonly snapshotId: string) {
    super();
  }
}
