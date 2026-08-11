import { HttpStatus, Injectable } from "@nestjs/common";
import {
  LEGAL_RULE_ERROR_CODES,
  LEGAL_RULE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-rule-catalog";

import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { problemException } from "../../../../platform/problems/problem-factory.js";

@Injectable()
export class RuleCatalogVersionService {
  constructor(private readonly prisma: PrismaService) {}

  async createDraft(version: string, correlationId: string) {
    if (!version?.trim()) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.corpusIngestInvalid,
        correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }
    const existing = await this.prisma.legalRuleCatalogVersion.findFirst({
      where: { version },
      select: { id: true },
    });
    if (existing) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.catalogVersionAlreadyApproved,
        correlationId,
        { status: HttpStatus.CONFLICT },
      );
    }
    const catalog = await this.prisma.legalRuleCatalogVersion.create({
      data: { version, ruleRefs: [] },
    });
    return {
      id: catalog.id,
      version: catalog.version,
      status: LEGAL_RULE_LIFECYCLE_STATUSES.draft,
    };
  }
}
