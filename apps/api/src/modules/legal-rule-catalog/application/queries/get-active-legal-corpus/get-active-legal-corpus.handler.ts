import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  LEGAL_RULE_ERROR_CODES,
  LEGAL_RULE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-rule-catalog";
import { toPrismaLegalRuleLifecycleStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { GetActiveLegalCorpusQuery } from "./get-active-legal-corpus.query.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";

type ActiveLegalCorpusResponse = {
  versionId: string;
  version: string;
  status: string;
  effectiveDate: string;
};

@QueryHandler(GetActiveLegalCorpusQuery)
export class GetActiveLegalCorpusHandler implements IQueryHandler<GetActiveLegalCorpusQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<ActiveLegalCorpusResponse> {
    const version = await this.prisma.legalCorpusVersion.findFirst({
      where: {
        status: toPrismaLegalRuleLifecycleStatus(
          LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        ),
      },
      orderBy: { createdAt: "desc" },
    });

    if (!version) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.approvedCorpusNotFound,
        "legal-corpus-active",
        { status: HttpStatus.SERVICE_UNAVAILABLE },
      );
    }

    return {
      versionId: version.id,
      version: version.version,
      status: LEGAL_RULE_LIFECYCLE_STATUSES.approved,
      effectiveDate:
        version.approvedAt?.toISOString() ?? version.createdAt.toISOString(),
    };
  }
}
