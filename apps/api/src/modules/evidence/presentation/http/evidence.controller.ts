import { randomUUID } from "node:crypto";

import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
  Query,
} from "@nestjs/common";
import { CommandBus, QueryBus } from "@nestjs/cqrs";
import { PBAC_ACTIONS } from "@lcsp/contracts/pbac";

import type { AuthenticatedRequest } from "../../../../common/interfaces/authenticated-request.interface.js";
import { PrismaService } from "../../../../infrastructure/prisma/prisma.service.js";
import { RequireAnyAction } from "../../../../platform/pbac/decorators/require-any-action.decorator.js";
import { PbacGuard } from "../../../../platform/pbac/pbac.guard.js";
import { resultEnvelope } from "../../../../platform/problems/result-envelope.js";
import { WorkerApiKeyGuard } from "../../../scan/presentation/http/worker-api-key.guard.js";
import { AcceptTechnicalProfileCommand } from "../../application/commands/accept-technical-profile/accept-technical-profile.command.js";
import type { TechnicalProfileCallbackRequest } from "../../application/contracts/evidence/technical-profile-callback.contract.js";
import { GetEvidenceQuery } from "../../application/queries/get-evidence/get-evidence.query.js";
import { GetFindingDetailQuery } from "../../application/queries/get-finding-detail/get-finding-detail.query.js";
import { SearchEvidenceQuery } from "../../application/queries/search-evidence/search-evidence.query.js";
import { FindProviderInvocationsQuery } from "../../application/queries/find-provider-invocations/find-provider-invocations.query.js";
import { GetEvidenceSubgraphQuery } from "../../application/queries/get-evidence-subgraph/get-evidence-subgraph.query.js";
import { GetSymbolContextQuery } from "../../application/queries/get-symbol-context/get-symbol-context.query.js";
import { TraceStaticFlowQuery } from "../../application/queries/trace-static-flow/trace-static-flow.query.js";
import { InspectHumanReviewPathQuery } from "../../application/queries/inspect-human-review-path/inspect-human-review-path.query.js";
import { GetScanCoverageQuery } from "../../application/queries/get-scan-coverage/get-scan-coverage.query.js";
import { InspectDecisionPathQuery } from "../../application/queries/inspect-decision-path/inspect-decision-path.query.js";
import { InspectDataPathQuery } from "../../application/queries/inspect-data-path/inspect-data-path.query.js";
import { FindSimilarSymbolsQuery } from "../../application/queries/find-similar-symbols/find-similar-symbols.query.js";
import { InspectDeploymentContextQuery } from "../../application/queries/inspect-deployment-context/inspect-deployment-context.query.js";
import {
  FINDING_DETAIL_INCLUDES,
  type FindingDetailInclude,
} from "../../application/contracts/evidence/finding-detail.contract.js";
import {
  SEARCH_EVIDENCE_CONFIDENCE,
  type SearchEvidenceConfidence,
} from "../../application/contracts/evidence/search-evidence.contract.js";
import {
  PROVIDER_INVOCATION_PROVIDERS,
  PROVIDER_INVOCATION_FRAMEWORKS,
  type ProviderInvocationFramework,
  type ProviderInvocationProvider,
} from "../../application/contracts/evidence/provider-invocation.contract.js";
import {
  EVIDENCE_SUBGRAPH_DIRECTIONS,
  type EvidenceSubgraphDirection,
} from "../../application/contracts/evidence/evidence-subgraph.contract.js";
import {
  SYMBOL_CONTEXT_INCLUDES,
  type SymbolContextInclude,
} from "../../application/contracts/evidence/symbol-context.contract.js";
import {
  STATIC_FLOW_DIRECTIONS,
  type StaticFlowDirection,
} from "../../application/contracts/evidence/static-flow.contract.js";
import {
  HUMAN_REVIEW_KINDS,
  type HumanReviewKind,
} from "../../application/contracts/evidence/human-review-path.contract.js";
import {
  DECISION_ACTION_CATEGORIES,
  type DecisionActionCategory,
} from "../../application/contracts/evidence/decision-path.contract.js";
import {
  DATA_CATEGORIES,
  DATA_PATH_DIRECTIONS,
  type DataCategory,
  type DataPathDirection,
} from "../../application/contracts/evidence/data-path.contract.js";
import {
  SYMBOL_SIMILARITY_DIMENSIONS,
  type SymbolSimilarityDimension,
} from "../../application/contracts/evidence/similar-symbols.contract.js";
import {
  DEPLOYMENT_ENVIRONMENTS,
  DEPLOYMENT_MANIFEST_KINDS,
} from "../../application/contracts/evidence/deployment-context.contract.js";
import { EVIDENCE_ERROR_CODES } from "@lcsp/contracts/evidence";
import { problemException } from "../../../../platform/problems/problem-factory.js";
import { HttpStatus } from "@nestjs/common";

@Controller("assessments")
export class EvidenceController {
  constructor(private readonly queryBus: QueryBus) {}

  @Get(":assessmentId/evidence")
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async getEvidence(
    @Param("assessmentId") assessmentId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    const context = request.pbacContext;
    return resultEnvelope(
      await this.queryBus.execute(
        new GetEvidenceQuery(
          assessmentId,
          context.organizationId,
          context.scope,
          context.selectedAction,
          request.correlationId as string,
        ),
      ),
    );
  }

  @Get(":assessmentId/evidence-reports/:evidenceReportId/coverage")
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async getScanCoverage(
    @Param("assessmentId") assessmentId: string,
    @Param("evidenceReportId") evidenceReportId: string,
    @Query("max_results") maxResultsRaw: string | undefined,
    @Query("path_prefixes") pathPrefixesRaw: string | undefined,
    @Query("tool_names") toolNamesRaw: string | undefined,
    @Query("languages") languagesRaw: string | undefined,
    @Query("dispositions") dispositionsRaw: string | undefined,
    @Query("cursor") cursorRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    return resultEnvelope(
      await this.queryBus.execute(
        new GetScanCoverageQuery(
          assessmentId,
          request.pbacContext.organizationId,
          evidenceReportId,
          parseBoundedInteger(maxResultsRaw, 1, 500, correlationId),
          correlationId,
          parsePathPrefixes(pathPrefixesRaw, correlationId),
          parseCsv(languagesRaw, correlationId),
          parseScanCoverageDispositions(dispositionsRaw, correlationId),
          parseCsv(toolNamesRaw, correlationId),
          parseOpaqueCursor(cursorRaw, correlationId),
        ),
      ),
    );
  }

  @Get(":assessmentId/evidence-reports/:evidenceReportId/findings/:findingId")
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async getFindingDetail(
    @Param("assessmentId") assessmentId: string,
    @Param("evidenceReportId") evidenceReportId: string,
    @Param("findingId") findingId: string,
    @Query("include") includeRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const include = parseFindingDetailInclude(
      includeRaw,
      request.correlationId as string,
    );
    return resultEnvelope(
      await this.queryBus.execute(
        new GetFindingDetailQuery(
          assessmentId,
          request.pbacContext.organizationId,
          evidenceReportId,
          findingId,
          include,
          request.correlationId as string,
        ),
      ),
    );
  }

  @Get(":assessmentId/evidence-reports/:evidenceReportId/findings")
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async searchEvidence(
    @Param("assessmentId") assessmentId: string,
    @Param("evidenceReportId") evidenceReportId: string,
    @Query("max_results") maxResultsRaw: string | undefined,
    @Query("finding_kinds") findingKindsRaw: string | undefined,
    @Query("providers") providersRaw: string | undefined,
    @Query("path_prefixes") pathPrefixesRaw: string | undefined,
    @Query("min_confidence") minConfidenceRaw: string | undefined,
    @Query("cursor") cursorRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    return resultEnvelope(
      await this.queryBus.execute(
        new SearchEvidenceQuery(
          assessmentId,
          request.pbacContext.organizationId,
          evidenceReportId,
          parseSearchMaxResults(maxResultsRaw, correlationId),
          correlationId,
          parseCsv(findingKindsRaw, correlationId),
          parseCsv(providersRaw, correlationId),
          parsePathPrefixes(pathPrefixesRaw, correlationId),
          parseSearchConfidence(minConfidenceRaw, correlationId),
          parseOpaqueCursor(cursorRaw, correlationId),
        ),
      ),
    );
  }

  @Get(":assessmentId/evidence-reports/:evidenceReportId/provider-invocations")
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async findProviderInvocations(
    @Param("assessmentId") assessmentId: string,
    @Param("evidenceReportId") evidenceReportId: string,
    @Query("max_results") maxResultsRaw: string | undefined,
    @Query("provider") providerRaw: string | undefined,
    @Query("framework") frameworkRaw: string | undefined,
    @Query("path_prefixes") pathPrefixesRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    return resultEnvelope(
      await this.queryBus.execute(
        new FindProviderInvocationsQuery(
          assessmentId,
          request.pbacContext.organizationId,
          evidenceReportId,
          parseSearchMaxResults(maxResultsRaw, correlationId),
          correlationId,
          parseProvider(providerRaw, correlationId),
          parsePathPrefixes(pathPrefixesRaw, correlationId),
          parseProviderFramework(frameworkRaw, correlationId),
        ),
      ),
    );
  }

  @Get(":assessmentId/evidence-reports/:evidenceReportId/subgraph/:seedNodeId")
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async getEvidenceSubgraph(
    @Param("assessmentId") assessmentId: string,
    @Param("evidenceReportId") evidenceReportId: string,
    @Param("seedNodeId") seedNodeId: string,
    @Query("direction") directionRaw: string | undefined,
    @Query("max_depth") maxDepthRaw: string | undefined,
    @Query("max_nodes") maxNodesRaw: string | undefined,
    @Query("max_edges") maxEdgesRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    return resultEnvelope(
      await this.queryBus.execute(
        new GetEvidenceSubgraphQuery(
          assessmentId,
          request.pbacContext.organizationId,
          evidenceReportId,
          seedNodeId,
          parseDirection(directionRaw, correlationId),
          parseBoundedInteger(maxDepthRaw, 1, 3, correlationId),
          parseBoundedInteger(maxNodesRaw, 1, 100, correlationId),
          parseBoundedInteger(maxEdgesRaw, 1, 200, correlationId),
          correlationId,
        ),
      ),
    );
  }

  @Get(":assessmentId/evidence-reports/:evidenceReportId/symbols/:symbolNodeId")
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async getSymbolContext(
    @Param("assessmentId") assessmentId: string,
    @Param("evidenceReportId") evidenceReportId: string,
    @Param("symbolNodeId") symbolNodeId: string,
    @Query("include") includeRaw: string | undefined,
    @Query("max_neighbors") maxNeighborsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    return resultEnvelope(
      await this.queryBus.execute(
        new GetSymbolContextQuery(
          assessmentId,
          request.pbacContext.organizationId,
          evidenceReportId,
          symbolNodeId,
          parseSymbolIncludes(includeRaw, correlationId),
          parseBoundedInteger(maxNeighborsRaw, 1, 50, correlationId),
          correlationId,
        ),
      ),
    );
  }

  @Get(
    ":assessmentId/evidence-reports/:evidenceReportId/static-flow/:startNodeId",
  )
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async traceStaticFlow(
    @Param("assessmentId") assessmentId: string,
    @Param("evidenceReportId") evidenceReportId: string,
    @Param("startNodeId") startNodeId: string,
    @Query("direction") directionRaw: string | undefined,
    @Query("max_hops") maxHopsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    return resultEnvelope(
      await this.queryBus.execute(
        new TraceStaticFlowQuery(
          assessmentId,
          request.pbacContext.organizationId,
          evidenceReportId,
          startNodeId,
          parseStaticFlowDirection(directionRaw, correlationId),
          parseBoundedInteger(maxHopsRaw, 1, 20, correlationId),
          correlationId,
        ),
      ),
    );
  }

  @Get(
    ":assessmentId/evidence-reports/:evidenceReportId/human-review-path/:startNodeId",
  )
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async inspectHumanReviewPath(
    @Param("assessmentId") assessmentId: string,
    @Param("evidenceReportId") evidenceReportId: string,
    @Param("startNodeId") startNodeId: string,
    @Query("review_kinds") reviewKindsRaw: string | undefined,
    @Query("max_hops") maxHopsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    return resultEnvelope(
      await this.queryBus.execute(
        new InspectHumanReviewPathQuery(
          assessmentId,
          request.pbacContext.organizationId,
          evidenceReportId,
          startNodeId,
          parseHumanReviewKinds(reviewKindsRaw, correlationId),
          parseBoundedInteger(maxHopsRaw, 1, 20, correlationId),
          correlationId,
        ),
      ),
    );
  }

  @Get(
    ":assessmentId/evidence-reports/:evidenceReportId/decision-path/:startNodeId",
  )
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async inspectDecisionPath(
    @Param("assessmentId") assessmentId: string,
    @Param("evidenceReportId") evidenceReportId: string,
    @Param("startNodeId") startNodeId: string,
    @Query("action_categories") actionCategoriesRaw: string | undefined,
    @Query("max_hops") maxHopsRaw: string | undefined,
    @Query("max_results") maxResultsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    return resultEnvelope(
      await this.queryBus.execute(
        new InspectDecisionPathQuery(
          assessmentId,
          request.pbacContext.organizationId,
          evidenceReportId,
          startNodeId,
          parseDecisionActionCategories(actionCategoriesRaw, correlationId),
          parseBoundedInteger(maxHopsRaw, 1, 20, correlationId),
          parseBoundedInteger(maxResultsRaw, 1, 100, correlationId),
          correlationId,
        ),
      ),
    );
  }

  @Get(
    ":assessmentId/evidence-reports/:evidenceReportId/data-path/:startNodeId",
  )
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async inspectDataPath(
    @Param("assessmentId") assessmentId: string,
    @Param("evidenceReportId") evidenceReportId: string,
    @Param("startNodeId") startNodeId: string,
    @Query("direction") directionRaw: string | undefined,
    @Query("data_categories") categoriesRaw: string | undefined,
    @Query("max_hops") maxHopsRaw: string | undefined,
    @Query("max_results") maxResultsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    return resultEnvelope(
      await this.queryBus.execute(
        new InspectDataPathQuery(
          assessmentId,
          request.pbacContext.organizationId,
          evidenceReportId,
          startNodeId,
          parseDataDirection(directionRaw, correlationId),
          parseDataCategories(categoriesRaw, correlationId),
          parseBoundedInteger(maxHopsRaw, 1, 20, correlationId),
          parseBoundedInteger(maxResultsRaw, 1, 100, correlationId),
          correlationId,
        ),
      ),
    );
  }

  @Get(
    ":assessmentId/evidence-reports/:evidenceReportId/similar-symbols/:seedNodeId",
  )
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async findSimilarSymbols(
    @Param("assessmentId") assessmentId: string,
    @Param("evidenceReportId") evidenceReportId: string,
    @Param("seedNodeId") seedNodeId: string,
    @Query("dimensions") dimensionsRaw: string | undefined,
    @Query("max_results") maxResultsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    return resultEnvelope(
      await this.queryBus.execute(
        new FindSimilarSymbolsQuery(
          assessmentId,
          request.pbacContext.organizationId,
          evidenceReportId,
          seedNodeId,
          parseSimilarityDimensions(dimensionsRaw, correlationId),
          parseBoundedInteger(maxResultsRaw, 1, 50, correlationId),
          correlationId,
        ),
      ),
    );
  }

  @Get(":assessmentId/evidence-reports/:evidenceReportId/deployment-context")
  @UseGuards(PbacGuard)
  @RequireAnyAction(
    PBAC_ACTIONS.evidenceRead,
    PBAC_ACTIONS.evidenceReadRedacted,
  )
  async inspectDeploymentContext(
    @Param("assessmentId") assessmentId: string,
    @Param("evidenceReportId") evidenceReportId: string,
    @Query("max_results") maxResultsRaw: string | undefined,
    @Req() request: AuthenticatedRequest,
  ) {
    const correlationId = request.correlationId as string;
    return resultEnvelope(
      await this.queryBus.execute(
        new InspectDeploymentContextQuery(
          assessmentId,
          request.pbacContext.organizationId,
          evidenceReportId,
          Object.values(DEPLOYMENT_MANIFEST_KINDS),
          Object.values(DEPLOYMENT_ENVIRONMENTS),
          parseBoundedInteger(maxResultsRaw, 1, 100, correlationId),
          correlationId,
        ),
      ),
    );
  }
}

function parseFindingDetailInclude(
  value: string | undefined,
  correlationId: string,
): FindingDetailInclude[] {
  const include = value?.split(",").map((item) => item.trim()) ?? [];
  const allowed = new Set(Object.values(FINDING_DETAIL_INCLUDES));
  if (
    include.length === 0 ||
    include.length > Object.keys(FINDING_DETAIL_INCLUDES).length ||
    include.some((item) => !allowed.has(item as FindingDetailInclude)) ||
    new Set(include).size !== include.length
  ) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return include as FindingDetailInclude[];
}

function parseSymbolIncludes(
  value: string | undefined,
  correlationId: string,
): SymbolContextInclude[] {
  const items = value?.split(",").map((item) => item.trim()) ?? [];
  const allowed = new Set(Object.values(SYMBOL_CONTEXT_INCLUDES));
  if (
    items.length === 0 ||
    items.length > Object.keys(SYMBOL_CONTEXT_INCLUDES).length ||
    items.some((item) => !allowed.has(item as SymbolContextInclude)) ||
    new Set(items).size !== items.length
  ) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return items as SymbolContextInclude[];
}

function parseSearchMaxResults(
  value: string | undefined,
  correlationId: string,
): number {
  const maxResults = Number(value);
  if (!Number.isInteger(maxResults) || maxResults < 1 || maxResults > 100) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return maxResults;
}

function parseCsv(value: string | undefined, correlationId: string): string[] {
  if (!value) return [];
  const result = value.split(",").map((item) => item.trim());
  if (result.some((item) => !item) || new Set(result).size !== result.length) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return result;
}

function parsePathPrefixes(
  value: string | undefined,
  correlationId: string,
): string[] {
  const paths = parseCsv(value, correlationId);
  if (
    paths.some(
      (path) =>
        path.startsWith("/") || path.includes("..") || !path.endsWith("/"),
    )
  ) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return paths;
}

function parseSearchConfidence(
  value: string | undefined,
  correlationId: string,
): SearchEvidenceConfidence | undefined {
  if (!value) return undefined;
  if (
    !Object.values(SEARCH_EVIDENCE_CONFIDENCE).includes(
      value as SearchEvidenceConfidence,
    )
  ) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return value as SearchEvidenceConfidence;
}

function parseScanCoverageDispositions(
  value: string | undefined,
  correlationId: string,
): Array<"ANALYZED" | "SKIPPED" | "LIMITED"> {
  const items = parseCsv(value, correlationId);
  const allowed = new Set(["ANALYZED", "SKIPPED", "LIMITED"]);
  if (items.some((item) => !allowed.has(item))) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return items as Array<"ANALYZED" | "SKIPPED" | "LIMITED">;
}

function parseOpaqueCursor(
  value: string | undefined,
  correlationId: string,
): string | null {
  if (!value) return null;
  if (value.length > 512) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return value;
}

function parseProvider(
  value: string | undefined,
  correlationId: string,
): ProviderInvocationProvider | undefined {
  if (!value) return undefined;
  if (
    !Object.values(PROVIDER_INVOCATION_PROVIDERS).includes(
      value as ProviderInvocationProvider,
    )
  ) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return value as ProviderInvocationProvider;
}

function parseProviderFramework(
  value: string | undefined,
  correlationId: string,
): ProviderInvocationFramework | undefined {
  if (!value) return undefined;
  if (
    !Object.values(PROVIDER_INVOCATION_FRAMEWORKS).includes(
      value as ProviderInvocationFramework,
    )
  ) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return value as ProviderInvocationFramework;
}

function parseDirection(
  value: string | undefined,
  correlationId: string,
): EvidenceSubgraphDirection {
  if (
    !value ||
    !Object.values(EVIDENCE_SUBGRAPH_DIRECTIONS).includes(
      value as EvidenceSubgraphDirection,
    )
  ) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return value as EvidenceSubgraphDirection;
}

function parseStaticFlowDirection(
  value: string | undefined,
  correlationId: string,
): StaticFlowDirection {
  if (
    !value ||
    !Object.values(STATIC_FLOW_DIRECTIONS).includes(
      value as StaticFlowDirection,
    )
  ) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return value as StaticFlowDirection;
}

function parseHumanReviewKinds(
  value: string | undefined,
  correlationId: string,
): HumanReviewKind[] {
  const kinds =
    value?.split(",").map((item) => item.trim()) ??
    Object.values(HUMAN_REVIEW_KINDS);
  if (
    kinds.length === 0 ||
    kinds.length > Object.keys(HUMAN_REVIEW_KINDS).length ||
    kinds.some(
      (item) =>
        !Object.values(HUMAN_REVIEW_KINDS).includes(item as HumanReviewKind),
    ) ||
    new Set(kinds).size !== kinds.length
  )
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  return kinds as HumanReviewKind[];
}

function parseDecisionActionCategories(
  value: string | undefined,
  correlationId: string,
): DecisionActionCategory[] {
  const categories =
    value?.split(",").map((item) => item.trim()) ??
    Object.values(DECISION_ACTION_CATEGORIES);
  if (
    categories.length === 0 ||
    categories.length > Object.keys(DECISION_ACTION_CATEGORIES).length ||
    categories.some(
      (item) =>
        !Object.values(DECISION_ACTION_CATEGORIES).includes(
          item as DecisionActionCategory,
        ),
    ) ||
    new Set(categories).size !== categories.length
  )
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  return categories as DecisionActionCategory[];
}

function parseDataDirection(
  value: string | undefined,
  correlationId: string,
): DataPathDirection {
  if (
    !value ||
    !Object.values(DATA_PATH_DIRECTIONS).includes(value as DataPathDirection)
  )
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  return value as DataPathDirection;
}
function parseDataCategories(
  value: string | undefined,
  correlationId: string,
): DataCategory[] {
  const categories =
    value?.split(",").map((item) => item.trim()) ??
    Object.values(DATA_CATEGORIES);
  if (
    categories.length === 0 ||
    categories.length > Object.keys(DATA_CATEGORIES).length ||
    categories.some(
      (item) => !Object.values(DATA_CATEGORIES).includes(item as DataCategory),
    ) ||
    new Set(categories).size !== categories.length
  )
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  return categories as DataCategory[];
}
function parseSimilarityDimensions(
  value: string | undefined,
  correlationId: string,
): SymbolSimilarityDimension[] {
  const dimensions =
    value?.split(",").map((item) => item.trim()) ??
    Object.values(SYMBOL_SIMILARITY_DIMENSIONS);
  if (
    dimensions.length === 0 ||
    dimensions.length > Object.keys(SYMBOL_SIMILARITY_DIMENSIONS).length ||
    dimensions.some(
      (item) =>
        !Object.values(SYMBOL_SIMILARITY_DIMENSIONS).includes(
          item as SymbolSimilarityDimension,
        ),
    ) ||
    new Set(dimensions).size !== dimensions.length
  )
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  return dimensions as SymbolSimilarityDimension[];
}

function parseBoundedInteger(
  value: string | undefined,
  min: number,
  max: number,
  correlationId: string,
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw problemException(EVIDENCE_ERROR_CODES.notFound, correlationId, {
      status: HttpStatus.NOT_FOUND,
    });
  }
  return parsed;
}

@Controller("internal/evidence")
export class InternalEvidenceController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly prisma: PrismaService,
  ) {}

  @Post("technical-profile-callback")
  @HttpCode(200)
  @UseGuards(WorkerApiKeyGuard)
  async acceptTechnicalProfile(
    @Body() payload: TechnicalProfileCallbackRequest,
    @Headers("x-correlation-id") correlationId?: string,
  ) {
    return resultEnvelope(
      await this.commandBus.execute(
        new AcceptTechnicalProfileCommand(
          payload,
          correlationId?.trim() || randomUUID(),
        ),
      ),
    );
  }

  @Get("reports/:evidenceReportId")
  @UseGuards(WorkerApiKeyGuard)
  async getTechnicalEvidenceReport(
    @Param("evidenceReportId") evidenceReportId: string,
  ) {
    const report = await this.prisma.technicalEvidenceReport.findUnique({
      where: { id: evidenceReportId },
      select: {
        id: true,
        scanJobId: true,
        assessmentId: true,
        organizationId: true,
        snapshotId: true,
        toolsVersion: true,
        configHash: true,
        evidencePayload: true,
        privacyFlags: true,
        schemaVersion: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
      },
    });
    if (!report) {
      throw new NotFoundException("TechnicalEvidenceReport not found");
    }

    return {
      id: report.id,
      scan_job_id: report.scanJobId,
      assessment_id: report.assessmentId,
      organization_id: report.organizationId,
      snapshot_id: report.snapshotId,
      tools_version: report.toolsVersion,
      config_hash: report.configHash,
      evidence_payload: report.evidencePayload,
      privacy_flags: report.privacyFlags,
      schema_version: report.schemaVersion,
      status: String(report.status).toLowerCase(),
      rejection_reason: report.rejectionReason,
      created_at: report.createdAt.toISOString(),
    };
  }

  @Get("technical-profiles/:technicalProfileId")
  @UseGuards(WorkerApiKeyGuard)
  async getTechnicalProfile(
    @Param("technicalProfileId") technicalProfileId: string,
  ) {
    const profile = await this.prisma.technicalProfile.findUnique({
      where: { id: technicalProfileId },
      select: {
        id: true,
        evidenceReportId: true,
        assessmentId: true,
        organizationId: true,
        schemaVersion: true,
        providerVersion: true,
        profileData: true,
        privacyFlags: true,
        status: true,
        rejectionReason: true,
        createdAt: true,
      },
    });
    if (!profile) {
      throw new NotFoundException("TechnicalProfile not found");
    }

    const profileData = isRecord(profile.profileData)
      ? profile.profileData
      : {};
    return {
      ...profileData,
      id: profile.id,
      technical_profile_id: profile.id,
      evidence_report_id: profile.evidenceReportId,
      assessment_id: profile.assessmentId,
      organization_id: profile.organizationId,
      schema_version: profile.schemaVersion,
      provider_version: profile.providerVersion,
      privacy_flags: profile.privacyFlags,
      status: String(profile.status).toLowerCase(),
      rejection_reason: profile.rejectionReason,
      created_at: profile.createdAt.toISOString(),
    };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
