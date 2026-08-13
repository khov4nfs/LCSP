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

    const cursorKey = query.cursor ? decodeCursor(query.cursor) : null;
    const matching = technicalFindings(report.evidencePayload)
      .filter((finding) => matches(finding, query))
      .sort(compareFindings);
    const afterCursor = cursorKey
      ? matching.filter((finding) => findingCursorKey(finding) > cursorKey)
      : matching;
    const page = afterCursor.slice(0, query.maxResults + 1);
    const truncated = page.length > query.maxResults;
    const pageFindings = page.slice(0, query.maxResults);
    const resultFindings = pageFindings.map(toSummary);
    const coverageLimited = scopeCoverageLimited(
      report.evidencePayload,
      query.pathPrefixes,
    );
    const nextCursor =
      truncated && pageFindings.length > 0
        ? encodeCursor(findingCursorKey(pageFindings[pageFindings.length - 1]))
        : null;
    const response: SearchEvidenceResponse = {
      status:
        resultFindings.length === 0 && coverageLimited
          ? AGENTIC_TOOL_STATUSES.outOfCoverage
          : AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.searchEvidence,
      tool_version: TOOL_VERSION,
      config_hash: TOOL_CONFIG_HASH,
      correlation_id: query.correlationId,
      artifact_versions: { technical_evidence_report_id: report.id },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: coverageLimited
        ? AGENTIC_TOOL_COVERAGE_STATES.limited
        : AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: resultFindings.map((finding) => finding.finding_ref),
      limitations: [
        ...(coverageLimited ? ["SCAN_COVERAGE_LIMITATION"] : []),
        ...(truncated ? ["RESULT_LIMIT_REACHED"] : []),
      ],
      result: {
        findings: resultFindings,
        searched_scope: {
          artifact_version: report.id,
          finding_kinds: query.findingKinds,
          providers: query.providers,
          path_prefixes: query.pathPrefixes,
          min_confidence: query.minConfidence ?? null,
          exhaustive: !coverageLimited && !truncated,
        },
        next_cursor: nextCursor,
        truncated,
      },
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
        truncated,
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
  return findingCursorKey(left).localeCompare(findingCursorKey(right));
}

function findingCursorKey(finding: Record<string, unknown>): string {
  const path = stringValue(finding.file_path) ?? "";
  const line = String(positiveInteger(finding.line_number) ?? 0).padStart(
    12,
    "0",
  );
  const id = stringValue(finding.finding_id) ?? "";
  return `${path}\u0000${line}\u0000${id}`;
}

function encodeCursor(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function decodeCursor(value: string): string | null {
  try {
    const decoded = Buffer.from(value, "base64url").toString("utf8");
    return decoded && encodeCursor(decoded) === value.replace(/=+$/u, "")
      ? decoded
      : null;
  } catch {
    return null;
  }
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

function scopeCoverageLimited(
  payload: unknown,
  pathPrefixes: string[],
): boolean {
  if (!isRecord(payload)) return false;
  const coverage = isRecord(payload.scan_coverage)
    ? payload.scan_coverage
    : null;
  const files = Array.isArray(coverage?.files) ? coverage.files : [];
  return files.some((item) => {
    if (!isRecord(item)) return false;
    const path = stringValue(item.file_path);
    const limited = item.coverage_limitation === true;
    if (!path || !limited) return false;
    if (pathPrefixes.length === 0) return true;
    return pathPrefixes.some((prefix) => path.startsWith(prefix));
  });
}
