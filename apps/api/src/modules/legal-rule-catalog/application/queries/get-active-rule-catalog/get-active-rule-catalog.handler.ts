import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  LEGAL_RULE_ERROR_CODES,
  LEGAL_RULE_LIFECYCLE_STATUSES,
} from "@lcsp/contracts/legal-rule-catalog";
import {
  fromPrismaLegalRuleLifecycleStatus,
  toPrismaLegalRuleLifecycleStatus,
} from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { GetActiveRuleCatalogQuery } from "./get-active-rule-catalog.query.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";

type ActiveRuleCatalogResponse = {
  versionId: string;
  version: string;
  status: string;
  rules: Array<{
    legalRuleId: string;
    requiredFacts: unknown;
    optionalFacts: unknown;
    blockingFacts: unknown;
    unknownFactPolicy: string;
    citationLocatorRefs: unknown;
    ruleFamily: string | null;
  }>;
};

@QueryHandler(GetActiveRuleCatalogQuery)
export class GetActiveRuleCatalogHandler implements IQueryHandler<GetActiveRuleCatalogQuery> {
  constructor(private readonly prisma: PrismaService) {}

  async execute(): Promise<ActiveRuleCatalogResponse> {
    const version = await this.prisma.legalRuleCatalogVersion.findFirst({
      where: {
        status: toPrismaLegalRuleLifecycleStatus(
          LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        ),
      },
      orderBy: { createdAt: "desc" },
    });

    if (!version) {
      throw problemException(
        LEGAL_RULE_ERROR_CODES.approvedCatalogNotFound,
        "legal-rule-catalog-active",
        { status: HttpStatus.SERVICE_UNAVAILABLE },
      );
    }

    const rules = await this.prisma.legalRule.findMany({
      where: {
        legalRuleCatalogVersionId: version.id,
        status: toPrismaLegalRuleLifecycleStatus(
          LEGAL_RULE_LIFECYCLE_STATUSES.approved,
        ),
      },
      orderBy: { legalRuleId: "asc" },
    });

    const locators = rules.flatMap((rule) =>
      Array.isArray(rule.citationLocatorRefs) ? rule.citationLocatorRefs : [],
    ) as Array<{
      legalCorpusVersionId?: string;
      documentId?: string;
      locator?: string;
    }>;
    const chunks = await this.prisma.legalDocumentChunk.findMany({
      where: {
        OR: locators
          .filter(
            (ref) => ref.legalCorpusVersionId && ref.documentId && ref.locator,
          )
          .map((ref) => ({
            legalCorpusVersionId: ref.legalCorpusVersionId,
            documentId: ref.documentId,
            locator: ref.locator,
            legalStatus: { not: "REPEALED" },
          })),
      },
      select: {
        id: true,
        legalCorpusVersionId: true,
        documentId: true,
        locator: true,
        legalStatus: true,
      },
    });
    const chunkByLocator = new Map(
      chunks.map((chunk) => [
        `${chunk.legalCorpusVersionId}:${chunk.documentId}:${chunk.locator}`,
        chunk,
      ]),
    );

    return {
      versionId: version.id,
      version: version.version,
      status: fromPrismaLegalRuleLifecycleStatus(version.status),
      rules: rules.map((rule) => ({
        legalRuleId: rule.legalRuleId,
        requiredFacts: rule.requiredFacts,
        optionalFacts: rule.optionalFacts,
        blockingFacts: rule.blockingFacts,
        unknownFactPolicy: rule.unknownFactPolicy,
        citationLocatorRefs: Array.isArray(rule.citationLocatorRefs)
          ? rule.citationLocatorRefs.map((ref) => {
              const locator = ref as {
                legalCorpusVersionId?: string;
                documentId?: string;
                locator?: string;
              };
              const chunk = chunkByLocator.get(
                `${locator.legalCorpusVersionId}:${locator.documentId}:${locator.locator}`,
              );
              return {
                ...locator,
                id: chunk?.id ?? "",
                legalStatus: chunk?.legalStatus ?? "REPEALED",
              };
            })
          : [],
        ruleFamily: rule.ruleFamily,
      })),
    };
  }
}
