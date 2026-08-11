import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  EVIDENCE_ERROR_CODES,
} from "@lcsp/contracts/evidence";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";

import { toPrismaEvidenceAcceptanceStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import {
  FINDING_DETAIL_INCLUDES,
  type FindingDetailResponse,
} from "../../contracts/evidence/finding-detail.contract.js";
import { GetFindingDetailQuery } from "./get-finding-detail.query.js";

const TOOL_VERSION = "1.0.0";
const TOOL_CONFIG_HASH = "sha256:finding-detail-v1";
const FORBIDDEN_KEY =
  /^(source_code|raw_source|raw_content|prompt|secret|token|password|credential|ast_body|full_ast|body|content|message)$/i;
const SECRET_PATTERNS = [
  /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/,
  /\bsk-ant-[A-Za-z0-9_-]{16,}\b/,
  /\bAKIA[A-Z0-9]{16}\b/,
];

@QueryHandler(GetFindingDetailQuery)
export class GetFindingDetailHandler implements IQueryHandler<
  GetFindingDetailQuery,
  FindingDetailResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(query: GetFindingDetailQuery): Promise<FindingDetailResponse> {
    const report = await this.prisma.technicalEvidenceReport.findFirst({
      where: {
        id: query.evidenceReportId,
        assessmentId: query.assessmentId,
        organizationId: query.organizationId,
        status: toPrismaEvidenceAcceptanceStatus(
          TECHNICAL_EVIDENCE_REPORT_STATUSES.accepted,
        ),
      },
      select: { id: true, evidencePayload: true },
    });
    if (!report) {
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        query.correlationId,
        {
          status: HttpStatus.NOT_FOUND,
        },
      );
    }

    const rawFinding = findTechnicalFinding(
      report.evidencePayload,
      query.findingId,
    );
    const finding =
      rawFinding && isSafeRecord(rawFinding)
        ? projectFinding(rawFinding, query.include)
        : null;
    const response: FindingDetailResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.getFindingDetail,
      tool_version: TOOL_VERSION,
      config_hash: TOOL_CONFIG_HASH,
      correlation_id: query.correlationId,
      artifact_versions: { technical_evidence_report_id: report.id },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: finding ? [`finding:${query.findingId}`] : [],
      limitations: [],
      result: { finding },
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.findingDetailRead,
      actorId: null,
      organizationId: query.organizationId,
      assessmentId: query.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.technicalEvidenceReport,
      resourceId: report.id,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: response.status,
      payload: {
        toolName: response.tool_name,
        findingRef: `finding:${query.findingId}`,
      },
    });
    return response;
  }
}

function findTechnicalFinding(
  payload: unknown,
  findingId: string,
): Record<string, unknown> | null {
  if (!isRecord(payload) || !Array.isArray(payload.technical_findings))
    return null;
  return (
    payload.technical_findings.find(
      (value): value is Record<string, unknown> =>
        isRecord(value) && value.finding_id === findingId,
    ) ?? null
  );
}

function projectFinding(
  finding: Record<string, unknown>,
  include: readonly string[],
): Record<string, unknown> | null {
  const findingType = stringValue(finding.finding_type);
  if (!findingType) return null;
  const result: Record<string, unknown> = {
    finding_ref: `finding:${String(finding.finding_id)}`,
    kind: findingType,
  };
  if (include.includes(FINDING_DETAIL_INCLUDES.location)) {
    const path = stringValue(finding.file_path);
    const line = positiveInteger(finding.line_number);
    if (path && line) result.relative_location = `${path}:${line}`;
  }
  if (include.includes(FINDING_DETAIL_INCLUDES.categories)) {
    result.categories = [
      findingType,
      stringValue(finding.library_group),
    ].filter(Boolean);
  }
  if (include.includes(FINDING_DETAIL_INCLUDES.confidence)) {
    result.confidence = confidenceLevel(finding.confidence);
  }
  if (include.includes(FINDING_DETAIL_INCLUDES.provenance)) {
    result.provenance = {
      tools: stringList(finding.source_tools),
      analysis_level: stringValue(finding.analysis_level),
    };
  }
  if (
    include.includes(FINDING_DETAIL_INCLUDES.limitations) &&
    finding.coverage_note
  ) {
    result.limitations = ["SCANNER_COVERAGE_LIMITATION"];
  }
  if (include.includes(FINDING_DETAIL_INCLUDES.relatedRefs)) {
    result.related_refs = [];
  }
  return result;
}

function isSafeRecord(value: Record<string, unknown>): boolean {
  return !Object.entries(value).some(
    ([key, item]) => FORBIDDEN_KEY.test(key) || containsSecret(item),
  );
}

function containsSecret(value: unknown): boolean {
  if (typeof value === "string")
    return SECRET_PATTERNS.some((pattern) => pattern.test(value));
  if (Array.isArray(value)) return value.some(containsSecret);
  if (isRecord(value)) return Object.values(value).some(containsSecret);
  return false;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() && !containsSecret(value)
    ? value.trim()
    : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const safe = stringValue(item);
        return safe ? [safe] : [];
      })
    : [];
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function confidenceLevel(value: unknown): string {
  if (typeof value !== "number") return "LOW";
  if (value >= 0.7) return "HIGH";
  if (value >= 0.4) return "MEDIUM";
  return "LOW";
}
