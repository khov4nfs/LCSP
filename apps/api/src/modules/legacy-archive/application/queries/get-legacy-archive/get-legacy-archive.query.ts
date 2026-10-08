import type { LegacyArchiveDetail } from "@lcsp/contracts/legacy-migration";
import { Query } from "@nestjs/cqrs";

export class GetLegacyArchiveQuery extends Query<LegacyArchiveDetail> {
  constructor(
    public readonly ownerId: string,
    public readonly assessmentId: string,
    public readonly correlationId: string,
  ) {
    super();
  }
}
