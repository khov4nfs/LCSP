import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  LEGAL_SOURCE_ERROR_CODES,
  LEGAL_SOURCE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-source";
import { toPrismaLegalSourceLifecycleStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { GetActiveLegalSourceQuery } from "./get-active-legal-source.query.js";
import { problemException } from "../../../../../platform/http/filters/error.factory.js";

type ActiveLegalSourceResponse = {
  versionId: string;
  version: string;
  status: string;
  effectiveDate: string;
};

@QueryHandler(GetActiveLegalSourceQuery)
export class GetActiveLegalSourceHandler implements IQueryHandler<GetActiveLegalSourceQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<ActiveLegalSourceResponse> {
    const version = await this.prisma.legalSourceVersion.findFirst({
      where: {
        status: toPrismaLegalSourceLifecycleStatus(
          LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
        ),
      },
      orderBy: { createdAt: "desc" },
    });

    if (!version) {
      throw problemException(
        LEGAL_SOURCE_ERROR_CODES.activeLegalSourceNotFound,
        "legal-source-active",
        { status: HttpStatus.SERVICE_UNAVAILABLE },
      );
    }

    return {
      versionId: version.id,
      version: version.version,
      status: LEGAL_SOURCE_LIFECYCLE_STATUSES.active,
      effectiveDate:
        version.activatedAt?.toISOString() ?? version.createdAt.toISOString(),
    };
  }
}
