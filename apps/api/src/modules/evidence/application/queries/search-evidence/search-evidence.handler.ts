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
  SEARCH_EVIDENCE_CONFIDENCE,
  type SearchEvidenceConfidence,
  type SearchEvidenceResponse,
} from "../../contracts/evidence/search-evidence.contract.js";
import { SearchEvidenceQuery } from "./search-evidence.query.js";

const TOOL_VERSION = "1.0.0";
const TOOL_CONFIG_HASH = "sha256:finding-projection-v1";

@QueryHandler(SearchEvidenceQuery)
export class SearchEvidenceHandler implements IQueryHandler<
  SearchEvidenceQuery,
  SearchEvidenceResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(query: SearchEvidenceQuery): Promise<SearchEvidenceResponse> {
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
    const findings = technicalFindings(report.evidencePayload)
      .filter((finding) => matches(finding, query))
      .sort(compareFindings)
      .slice(0, query.maxResults + 1);
    const truncated = findings.length > query.maxResults;
    const resultFindings = findings.slice(0, query.maxResults).map(toSummary);
    const response: SearchEvidenceResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.searchEvidence,
      tool_version: TOOL_VERSION,
      config_hash: TOOL_CONFIG_HASH,
      correlation_id: query.correlationId,
      artifact_versions: { technical_evidence_report_id: report.id },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: resultFindings.map((finding) => finding.finding_ref),
      limitations: truncated ? ["RESULT_LIMIT_REACHED"] : [],
      result: { findings: resultFindings, next_cursor: null, truncated },
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.evidenceSearchRead,
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
        resultCount: resultFindings.length,
      },
    });
    return response;
  }
}

function technicalFindings(payload: unknown): Record<string, unknown>[] {
  if (!isRecord(payload) || !Array.isArray(payload.technical_findings))
    return [];
  return payload.technical_findings.filter(isSafeFinding);
}

function matches(
  finding: Record<string, unknown>,
  query: SearchEvidenceQuery,
): boolean {
  const kind = stringValue(finding.finding_type);
  const provider = providerFor(finding);
  const path = stringValue(finding.file_path);
  const confidence = confidenceLevel(finding.confidence);
  if (!kind) return false;
  return (
    (query.findingKinds.length === 0 || query.findingKinds.includes(kind)) &&
    (query.providers.length === 0 ||
      (provider !== null && query.providers.includes(provider))) &&
    (query.pathPrefixes.length === 0 ||
      (path !== null &&
        query.pathPrefixes.some((prefix) => path.startsWith(prefix)))) &&
    (query.minConfidence === undefined ||
      confidenceRank(confidence) >= confidenceRank(query.minConfidence))
  );
}

function toSummary(finding: Record<string, unknown>) {
  const path = stringValue(finding.file_path);
  const line = positiveInteger(finding.line_number);
  const id = stringValue(finding.finding_id) ?? "";
  return {
    finding_ref: `finding:${id}`,
    kind: stringValue(finding.finding_type) ?? "UNKNOWN",
    relative_location: path && line ? `${path}:${line}` : null,
    provider: providerFor(finding),
    confidence: confidenceLevel(finding.confidence),
    evidence_refs: [`finding:${id}`],
    limitation_refs: finding.coverage_note
      ? ["SCANNER_COVERAGE_LIMITATION"]
      : [],
  };
}

function compareFindings(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  const path = (stringValue(left.file_path) ?? "").localeCompare(
    stringValue(right.file_path) ?? "",
  );
  if (path !== 0) return path;
  const line =
    (positiveInteger(left.line_number) ?? 0) -
    (positiveInteger(right.line_number) ?? 0);
  return line !== 0
    ? line
    : (stringValue(left.finding_id) ?? "").localeCompare(
        stringValue(right.finding_id) ?? "",
      );
}

function providerFor(finding: Record<string, unknown>): string | null {
  const library = stringValue(finding.library_group)?.toUpperCase();
  if (!library) return null;
  if (library.includes("OPENAI")) return "OPENAI";
  if (library.includes("ANTHROPIC")) return "ANTHROPIC";
  if (library.includes("GOOGLE") || library.includes("GEMINI")) return "GOOGLE";
  if (library.includes("AZURE")) return "AZURE_OPENAI";
  return "OTHER";
}

function isSafeFinding(value: unknown): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        !/^(source_code|raw_source|raw_content|prompt|secret|token|password|credential|ast_body|full_ast|body|content|message)$/i.test(
          key,
        ) && !containsSecret(item),
    )
  );
}

function containsSecret(value: unknown): boolean {
  if (typeof value === "string")
    return /\b(gh[oprsu]_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/.test(
      value,
    );
  if (Array.isArray(value)) return value.some(containsSecret);
  return isRecord(value) && Object.values(value).some(containsSecret);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function positiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}

function confidenceLevel(value: unknown): SearchEvidenceConfidence {
  if (typeof value !== "number" || value < 0.4)
    return SEARCH_EVIDENCE_CONFIDENCE.low;
  if (value < 0.7) return SEARCH_EVIDENCE_CONFIDENCE.medium;
  return SEARCH_EVIDENCE_CONFIDENCE.high;
}

function confidenceRank(value: SearchEvidenceConfidence): number {
  if (value === SEARCH_EVIDENCE_CONFIDENCE.high) return 3;
  if (value === SEARCH_EVIDENCE_CONFIDENCE.medium) return 2;
  return 1;
}
