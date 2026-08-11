import { createHash } from "node:crypto";

import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import {
  ClassificationGuardrailStatus,
  EvidenceAcceptanceStatus,
  OverallCoverageStatus,
} from "@prisma/client";
import { ASSESSMENT_ERROR_CODES } from "@lcsp/contracts/assessment";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  GAP_MATRIX_RESOLVER_TYPES,
  GAP_TRACE_LAYERS,
  GAP_TRACE_LIMITATION_CODES,
  GET_GAP_EVIDENCE_TRACE_TOOL,
  type GetGapEvidenceTraceResponse,
} from "@lcsp/contracts/evidence";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";

import { toPrismaEvidenceAcceptanceStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import { GetGapEvidenceTraceQuery } from "./get-gap-evidence-trace.query.js";

const GAP_ROW_PREFIX = "gap-row:";
const ROW_KEYS = {
  systemType: "system_type",
  riskLevel: "risk_level",
  citationBasis: "citation_basis",
} as const;

type ClassificationProjection = {
  id: string;
  legalRuleMatchId: string | null;
  verifiedProfileId: string | null;
  classificationData: unknown;
  guardrailStatus: ClassificationGuardrailStatus;
};

type MatchProjection = {
  id: string;
  verifiedProfileId: string;
  citationAllowlist: unknown;
  overallCoverageStatus: OverallCoverageStatus;
};

@QueryHandler(GetGapEvidenceTraceQuery)
export class GetGapEvidenceTraceHandler implements IQueryHandler<
  GetGapEvidenceTraceQuery,
  GetGapEvidenceTraceResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: GetGapEvidenceTraceQuery,
  ): Promise<GetGapEvidenceTraceResponse> {
    const assessment = await this.prisma.assessment.findFirst({
      where: { id: query.assessmentId, organizationId: query.organizationId },
      select: { id: true },
    });
    if (!assessment) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const parsed = parseRowRef(query.input.rowRef);
    if (!parsed) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.invalidRequest,
        query.correlationId,
        { status: HttpStatus.UNPROCESSABLE_ENTITY },
      );
    }

    const classification = await this.prisma.classificationResult.findFirst({
      where: {
        id: parsed.classificationId,
        assessmentId: assessment.id,
        organizationId: query.organizationId,
        status: EvidenceAcceptanceStatus.ACCEPTED,
      },
      select: {
        id: true,
        legalRuleMatchId: true,
        verifiedProfileId: true,
        classificationData: true,
        guardrailStatus: true,
      },
    });
    if (!classification?.legalRuleMatchId) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const [match, verifiedProfile, technicalEvidenceReport] = await Promise.all(
      [
        this.prisma.legalRuleMatch.findFirst({
          where: {
            id: classification.legalRuleMatchId,
            assessmentId: assessment.id,
            organizationId: query.organizationId,
            status: EvidenceAcceptanceStatus.ACCEPTED,
          },
          select: {
            id: true,
            verifiedProfileId: true,
            citationAllowlist: true,
            overallCoverageStatus: true,
          },
        }),
        classification.verifiedProfileId
          ? this.prisma.verifiedProfile.findFirst({
              where: {
                id: classification.verifiedProfileId,
                assessmentId: assessment.id,
                organizationId: query.organizationId,
              },
              select: {
                id: true,
                technicalEvidenceReportId: true,
              },
            })
          : Promise.resolve(null),
        this.prisma.technicalEvidenceReport.findFirst({
          where: {
            assessmentId: assessment.id,
            organizationId: query.organizationId,
            status: toPrismaEvidenceAcceptanceStatus(
              TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
            ),
          },
          orderBy: { createdAt: "desc" },
          select: { id: true },
        }),
      ],
    );

    if (!match) {
      throw problemException(
        ASSESSMENT_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const trace = buildTrace({
      rowRef: query.input.rowRef,
      rowKey: parsed.rowKey,
      classification,
      match,
      verifiedProfileId: classification.verifiedProfileId,
      technicalEvidenceReportId:
        verifiedProfile?.technicalEvidenceReportId ??
        technicalEvidenceReport?.id ??
        null,
    });

    const response: GetGapEvidenceTraceResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      toolName: AGENTIC_TOOL_NAMES.getGapEvidenceTrace,
      toolVersion: GET_GAP_EVIDENCE_TRACE_TOOL.version,
      configHash: GET_GAP_EVIDENCE_TRACE_TOOL.configHash,
      correlationId: query.correlationId,
      artifactVersions: { gapRowRef: query.input.rowRef },
      provenanceRef: provenanceRef(query.correlationId),
      coverageState: trace.coverageState,
      evidenceRefs: trace.evidenceRefs,
      limitations: trace.limitations,
      result: {
        rowRef: query.input.rowRef,
        layers: trace.layers,
        resolverType: trace.resolverType,
      },
    };

    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.gapEvidenceTraceRead,
      actorId: query.actorId,
      organizationId: query.organizationId,
      assessmentId: assessment.id,
      resourceType: AUDIT_RESOURCE_TYPES.assessment,
      resourceId: assessment.id,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      payload: {
        toolName: response.toolName,
        gapRowRef: query.input.rowRef,
        outputHash: safeHash(response.result),
        evidenceRefHash: safeHash(response.evidenceRefs),
      },
    });

    return response;
  }
}

function buildTrace(input: {
  rowRef: string;
  rowKey: string;
  classification: ClassificationProjection;
  match: MatchProjection;
  verifiedProfileId: string | null;
  technicalEvidenceReportId: string | null;
}) {
  const data = record(input.classification.classificationData);
  const coverageLimited =
    input.match.overallCoverageStatus !==
    OverallCoverageStatus.COMPLETE_CITATION;
  const allowlist = refs(input.match.citationAllowlist);
  const fieldValue = data?.[input.rowKey];
  const evidenceRefs =
    input.rowKey === ROW_KEYS.citationBasis && Array.isArray(fieldValue)
      ? fieldValue
          .filter((item): item is string => typeof item === "string")
          .sort()
      : [];

  if (coverageLimited) {
    return {
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.limited,
      evidenceRefs: [],
      limitations: [
        {
          code: GAP_TRACE_LIMITATION_CODES.provenanceLimited,
          affectedScopeRef: input.rowRef,
          reason:
            "The accepted legal rule match does not have complete citation coverage.",
          retryable: false,
        },
      ],
      resolverType: GAP_MATRIX_RESOLVER_TYPES.collectEvidence,
      layers: compactLayers([
        layer(
          GAP_TRACE_LAYERS.technicalEvidence,
          reportRef(input.technicalEvidenceReportId),
        ),
        layer(GAP_TRACE_LAYERS.legalRuleMatch, `rule-match:${input.match.id}`),
        layer(
          GAP_TRACE_LAYERS.classificationResult,
          `classification:${input.classification.id}`,
        ),
      ]),
    };
  }

  if (input.rowKey === ROW_KEYS.citationBasis) {
    const invalidCitation =
      !Array.isArray(fieldValue) ||
      fieldValue.some(
        (item) => typeof item !== "string" || !allowlist.includes(item),
      );
    if (invalidCitation) {
      return {
        coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
        evidenceRefs: [],
        limitations: [],
        resolverType: GAP_MATRIX_RESOLVER_TYPES.reviewCitations,
        layers: compactLayers([
          layer(
            GAP_TRACE_LAYERS.citationSet,
            `rule-match:${input.match.id}:citation-allowlist`,
          ),
          layer(
            GAP_TRACE_LAYERS.legalRuleMatch,
            `rule-match:${input.match.id}`,
          ),
          layer(
            GAP_TRACE_LAYERS.classificationResult,
            `classification:${input.classification.id}`,
          ),
        ]),
      };
    }
  }

  if (
    fieldValue === null ||
    fieldValue === undefined ||
    (typeof fieldValue !== "string" && !Array.isArray(fieldValue))
  ) {
    return {
      coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidenceRefs: [],
      limitations: [],
      resolverType: GAP_MATRIX_RESOLVER_TYPES.refreshClassification,
      layers: compactLayers([
        layer(
          GAP_TRACE_LAYERS.classificationResult,
          `classification:${input.classification.id}`,
        ),
        layer(
          GAP_TRACE_LAYERS.verifiedProfile,
          input.verifiedProfileId ? `profile_${input.verifiedProfileId}` : null,
        ),
      ]),
    };
  }

  return {
    coverageState: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
    evidenceRefs,
    limitations: [],
    resolverType: GAP_MATRIX_RESOLVER_TYPES.collectEvidence,
    layers: compactLayers([
      layer(
        GAP_TRACE_LAYERS.technicalEvidence,
        reportRef(input.technicalEvidenceReportId),
      ),
      layer(
        GAP_TRACE_LAYERS.verifiedProfile,
        input.verifiedProfileId ? `profile_${input.verifiedProfileId}` : null,
      ),
      layer(GAP_TRACE_LAYERS.legalRuleMatch, `rule-match:${input.match.id}`),
      layer(
        GAP_TRACE_LAYERS.classificationResult,
        `classification:${input.classification.id}`,
      ),
    ]),
  };
}

function compactLayers(
  layers: Array<{
    layer: (typeof GAP_TRACE_LAYERS)[keyof typeof GAP_TRACE_LAYERS];
    artifactRef: string | null;
  }>,
) {
  return layers.flatMap((item) =>
    item.artifactRef
      ? [{ layer: item.layer, artifactRef: item.artifactRef }]
      : [],
  );
}

function layer(
  layerValue: (typeof GAP_TRACE_LAYERS)[keyof typeof GAP_TRACE_LAYERS],
  artifactRef: string | null,
) {
  return { layer: layerValue, artifactRef };
}

function parseRowRef(
  rowRef: string,
): { classificationId: string; rowKey: string } | null {
  if (!rowRef.startsWith(GAP_ROW_PREFIX)) {
    return null;
  }
  const parts = rowRef.slice(GAP_ROW_PREFIX.length).split(":");
  if (parts.length < 2) {
    return null;
  }
  const classificationId = parts.shift();
  const rowKey = parts.join(":");
  if (!classificationId || !rowKey) {
    return null;
  }
  return { classificationId, rowKey };
}

function reportRef(reportId: string | null): string | null {
  return reportId ? `report:${reportId}` : null;
}

function refs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function provenanceRef(correlationId: string): string {
  return `gap-trace:${safeHash(correlationId).slice(0, 24)}`;
}

function safeHash(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
