import type { LegacyArchiveList } from "@lcsp/contracts/legacy-migration";
import { Query } from "@nestjs/cqrs";

export class ListLegacyArchivesQuery extends Query<LegacyArchiveList> {
  constructor(
    public readonly ownerId: string,
    public readonly page: number,
    public readonly pageSize: number,
    public readonly correlationId: string,
  ) {
    super();
  }
}
