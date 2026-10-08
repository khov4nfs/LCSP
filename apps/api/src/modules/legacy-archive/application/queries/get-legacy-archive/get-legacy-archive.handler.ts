import {
  LEGACY_MIGRATION_ERROR_CODES,
  legacyArchiveDetailSchema,
  type LegacyArchiveDetail,
} from "@lcsp/contracts/legacy-migration";
import { HttpStatus } from "@nestjs/common";
import { type IQueryHandler, QueryHandler } from "@nestjs/cqrs";

import { problemException } from "../../../../../platform/http/filters/error.factory.js";
import { LegacyArchiveReadRepository } from "../../../infrastructure/persistence/legacy-archive-read.repository.js";
import { GetLegacyArchiveQuery } from "./get-legacy-archive.query.js";

@QueryHandler(GetLegacyArchiveQuery)
export class GetLegacyArchiveHandler implements IQueryHandler<GetLegacyArchiveQuery> {
  constructor(private readonly archive: LegacyArchiveReadRepository) {}

  async execute(query: GetLegacyArchiveQuery): Promise<LegacyArchiveDetail> {
    const detail = await this.archive.detail(query.ownerId, query.assessmentId);
    // Another customer's archive and a missing one are indistinguishable by design.
    if (!detail)
      throw problemException(
        LEGACY_MIGRATION_ERROR_CODES.ARCHIVE_NOT_FOUND,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    return legacyArchiveDetailSchema.parse({
      ...detail,
      correlationId: query.correlationId,
    });
  }
}
