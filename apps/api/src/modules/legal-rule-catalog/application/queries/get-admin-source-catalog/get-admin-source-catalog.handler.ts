import { createHash } from "node:crypto";

import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  ADMIN_SOURCE_CATALOG_LIMITATION_CODES,
  GET_ADMIN_SOURCE_CATALOG_TOOL,
  type GetAdminSourceCatalogResponse,
} from "@lcsp/contracts/evidence";

import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { AdminSourceCatalogService } from "../../services/admin-source-catalog.service.js";
import { GetAdminSourceCatalogQuery } from "./get-admin-source-catalog.query.js";

@QueryHandler(GetAdminSourceCatalogQuery)
export class GetAdminSourceCatalogHandler implements IQueryHandler<
  GetAdminSourceCatalogQuery,
  GetAdminSourceCatalogResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
    private readonly catalog: AdminSourceCatalogService,
  ) {}

  async execute(
    query: GetAdminSourceCatalogQuery,
  ): Promise<GetAdminSourceCatalogResponse> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: query.assessmentId },
      select: { id: true },
    });
    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const resolved = this.catalog.resolve(query.input);
    if (resolved.kind === "resolved") {
      const response: GetAdminSourceCatalogResponse = {
        status: AGENTIC_TOOL_STATUSES.ready,
        toolName: AGENTIC_TOOL_NAMES.getAdminSourceCatalog,
        toolVersion: GET_ADMIN_SOURCE_CATALOG_TOOL.version,
        configHash: GET_ADMIN_SOURCE_CATALOG_TOOL.configHash,
        correlationId: query.correlationId,
        artifactVersions: {
          adminCatalogVersion: this.catalog.catalogVersion,
        },
        provenanceRef: provenanceRef(query.correlationId),
        coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
        evidenceRefs: [resolved.evidenceRef],
        limitations: [],
        result: {
          catalogSourceRef: resolved.evidenceRef,
          documentIdentity: resolved.documentIdentity ?? null,
          allowedHost: resolved.entry.allowedHost,
          pathPolicy: resolved.entry.pathPolicy,
          sourceHierarchy: resolved.entry.sourceHierarchy,
          catalogVersion: this.catalog.catalogVersion,
        },
      };
      return this.writeAndReturn(query, assessment.id, response);
    }

    if (resolved.kind === "conflict") {
      return this.writeAndReturn(query, assessment.id, {
        status: AGENTIC_TOOL_STATUSES.conflict,
        toolName: AGENTIC_TOOL_NAMES.getAdminSourceCatalog,
        toolVersion: GET_ADMIN_SOURCE_CATALOG_TOOL.version,
        configHash: GET_ADMIN_SOURCE_CATALOG_TOOL.configHash,
        correlationId: query.correlationId,
        artifactVersions: {
          adminCatalogVersion: this.catalog.catalogVersion,
        },
        provenanceRef: provenanceRef(query.correlationId),
        coverageState: AGENTIC_TOOL_COVERAGE_STATES.partial,
        evidenceRefs: [],
        limitations: [
          {
            code: ADMIN_SOURCE_CATALOG_LIMITATION_CODES.catalogLookupAmbiguous,
            affectedScopeRef: null,
            reason: resolved.reason,
            retryable: false,
          },
        ],
        result: {
          catalogSourceRef: null,
          documentIdentity: query.input.documentIdentity ?? null,
          allowedHost: null,
          pathPolicy: null,
          sourceHierarchy: null,
          catalogVersion: this.catalog.catalogVersion,
        },
      });
    }

    return this.writeAndReturn(query, assessment.id, {
      status: AGENTIC_TOOL_STATUSES.needsInput,
      toolName: AGENTIC_TOOL_NAMES.getAdminSourceCatalog,
      toolVersion: GET_ADMIN_SOURCE_CATALOG_TOOL.version,
      configHash: GET_ADMIN_SOURCE_CATALOG_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: {
        adminCatalogVersion: this.catalog.catalogVersion,
      },
      provenanceRef: provenanceRef(query.correlationId),
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.unavailable,
      evidenceRefs: [],
      limitations: [
        {
          code: ADMIN_SOURCE_CATALOG_LIMITATION_CODES.catalogEntryUnavailable,
          affectedScopeRef: null,
          reason: resolved.reason,
          retryable: false,
        },
      ],
      result: {
        catalogSourceRef: null,
        documentIdentity: query.input.documentIdentity ?? null,
        allowedHost: null,
        pathPolicy: null,
        sourceHierarchy: null,
        catalogVersion: this.catalog.catalogVersion,
      },
    });
  }

  private async writeAndReturn(
    query: GetAdminSourceCatalogQuery,
    assessmentId: string,
    response: GetAdminSourceCatalogResponse,
  ): Promise<GetAdminSourceCatalogResponse> {
    const outputHash = createHash("sha256")
      .update(JSON.stringify(response))
      .digest("hex");
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.adminSourceCatalogRead,
      actorId: query.actorId,
      assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessmentId,
      correlationId: query.correlationId,
      decision:
        response.status === AGENTIC_TOOL_STATUSES.ready
          ? AUDIT_DECISIONS.allow
          : AUDIT_DECISIONS.deny,
      result: response.status,
      payload: {
        toolName: response.toolName,
        toolVersion: response.toolVersion,
        coverageState: response.coverageState,
        limitationCodes: response.limitations.map((item) => item.code),
        evidenceRefs: response.evidenceRefs,
        outputHash: `sha256:${outputHash}`,
      },
    });
    return response;
  }
}

function provenanceRef(correlationId: string): string {
  return `prov:admin-source-catalog:${correlationId}`;
}
