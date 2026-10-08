import {
  legacyArchiveListSchema,
  type LegacyArchiveList,
} from "@lcsp/contracts/legacy-migration";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";

import { LegacyArchiveReadRepository } from "../../../infrastructure/persistence/legacy-archive-read.repository.js";
import { ListLegacyArchivesQuery } from "./list-legacy-archives.query.js";

@QueryHandler(ListLegacyArchivesQuery)
export class ListLegacyArchivesHandler implements IQueryHandler<ListLegacyArchivesQuery> {
  constructor(private readonly archive: LegacyArchiveReadRepository) {}

  async execute(query: ListLegacyArchivesQuery): Promise<LegacyArchiveList> {
    const { archives, total } = await this.archive.list(
      query.ownerId,
      query.page,
      query.pageSize,
    );
    return legacyArchiveListSchema.parse({
      archives,
      total,
      page: query.page,
      page_size: query.pageSize,
      correlationId: query.correlationId,
    });
  }
}
