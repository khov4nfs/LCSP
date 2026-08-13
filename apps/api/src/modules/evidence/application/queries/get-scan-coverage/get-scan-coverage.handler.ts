import { AUDIT_DECISIONS, AUDIT_RESOURCE_TYPES } from "@lcsp/contracts/audit";
import {
  AGENTIC_TOOL_COVERAGE_STATES,
  AGENTIC_TOOL_EVENT_TYPES,
  AGENTIC_TOOL_NAMES,
  AGENTIC_TOOL_STATUSES,
  EVIDENCE_ERROR_CODES,
} from "@lcsp/contracts/evidence";
import { TECHNICAL_EVIDENCE_REPORT_STATUSES } from "@lcsp/contracts/scan";
import { HttpStatus } from "@nestjs/common";
import { QueryHandler, type IQueryHandler } from "@nestjs/cqrs";
import { toPrismaEvidenceAcceptanceStatus } from "../../../../../infrastructure/prisma/prisma-enum-mappers.js";
import { PrismaService } from "../../../../../infrastructure/prisma/prisma.service.js";
import { AuditWriterService } from "../../../../../platform/audit/audit-writer.service.js";
import { problemException } from "../../../../../platform/problems/problem-factory.js";
import {
  SCAN_COVERAGE_DISPOSITIONS,
  SCAN_COVERAGE_MAX_RESULTS,
  type ScanCoverageResponse,
} from "../../contracts/evidence/scan-coverage.contract.js";
import { GetScanCoverageQuery } from "./get-scan-coverage.query.js";

@QueryHandler(GetScanCoverageQuery)
export class GetScanCoverageHandler implements IQueryHandler<
  GetScanCoverageQuery,
  ScanCoverageResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(query: GetScanCoverageQuery): Promise<ScanCoverageResponse> {
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
    const coverage = coverageData(report?.evidencePayload);
    if (!report || !coverage) {
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    }

    const cursorPath = query.cursor ? decodeCursor(query.cursor) : null;
    const all = coverage.files
      .filter((item) => matchesSelectors(item, query))
      .sort((a, b) => a.path.localeCompare(b.path));
    const afterCursor = cursorPath
      ? all.filter((item) => item.path.localeCompare(cursorPath) > 0)
      : all;
    const limit = Math.min(
      SCAN_COVERAGE_MAX_RESULTS,
      Math.max(1, query.maxResults),
    );
    const files = afterCursor.slice(0, limit);
    const truncated = afterCursor.length > files.length;
    const nextCursor =
      truncated && files.length > 0
        ? encodeCursor(files[files.length - 1].path)
        : null;
    const counts = {
      total: all.length,
      analyzed: all.filter(
        (item) => item.disposition === SCAN_COVERAGE_DISPOSITIONS.analyzed,
      ).length,
      skipped: all.filter(
        (item) => item.disposition === SCAN_COVERAGE_DISPOSITIONS.skipped,
      ).length,
      limited: all.filter(
        (item) => item.disposition === SCAN_COVERAGE_DISPOSITIONS.limited,
      ).length,
    };
    const response: ScanCoverageResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.getScanCoverage,
      tool_version: "1.0.0",
      config_hash: "sha256:scan-coverage-v1",
      correlationId: query.correlationId,
      artifact_versions: { technical_evidence_report_id: report.id },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state:
        counts.limited > 0
          ? AGENTIC_TOOL_COVERAGE_STATES.limited
          : AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: files.map((item) => `coverage:file:${item.path}`),
      limitations: files
        .filter(
          (item) => item.disposition === SCAN_COVERAGE_DISPOSITIONS.limited,
        )
        .flatMap((item) => item.limitation_refs),
      result: {
        files,
        searched_scope: {
          artifact_version: report.id,
          path_prefixes: query.pathPrefixes,
          languages: query.languages,
          dispositions: query.dispositions,
          tool_names: query.toolNames,
          exhaustive: !truncated,
        },
        tool_outcomes:
          query.toolNames.length > 0
            ? coverage.toolOutcomes.filter((item) =>
                query.toolNames.includes(item.tool_name),
              )
            : coverage.toolOutcomes,
        unresolved_dynamic_boundaries: coverage.unresolvedDynamicBoundaries,
        counts,
        next_cursor: nextCursor,
        truncated,
      },
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.scanCoverageRead,
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
        reportRef: `report:${report.id}`,
        resultCount: files.length,
        truncated,
      },
    });
    return response;
  }
}

function matchesSelectors(
  item: ScanCoverageResponse["result"]["files"][number],
  query: GetScanCoverageQuery,
): boolean {
  if (
    query.pathPrefixes.length > 0 &&
    !query.pathPrefixes.some((prefix) => item.path.startsWith(prefix))
  ) {
    return false;
  }
  if (
    query.languages.length > 0 &&
    !query.languages.some(
      (language) => language.toLowerCase() === item.language.toLowerCase(),
    )
  ) {
    return false;
  }
  if (
    query.dispositions.length > 0 &&
    !query.dispositions.includes(item.disposition)
  ) {
    return false;
  }
  return true;
}

function encodeCursor(path: string): string {
  return Buffer.from(path, "utf8").toString("base64url");
}

function decodeCursor(cursor: string): string | null {
  try {
    const path = Buffer.from(cursor, "base64url").toString("utf8");
    if (!path || encodeCursor(path) !== cursor.replace(/=+$/u, "")) return null;
    return path;
  } catch {
    return null;
  }
}

function coverageData(payload: unknown): {
  files: ScanCoverageResponse["result"]["files"];
  toolOutcomes: ScanCoverageResponse["result"]["tool_outcomes"];
  unresolvedDynamicBoundaries: ScanCoverageResponse["result"]["unresolved_dynamic_boundaries"];
} | null {
  const root = record(payload);
  const coverage = root && record(root.scan_coverage);
  if (!coverage || !Array.isArray(coverage.files)) return null;
  return {
    files: coverage.files.flatMap(
      (value): ScanCoverageResponse["result"]["files"] => {
        const file = record(value);
        const path = file && text(file.file_path);
        const language = file && text(file.language);
        const support = file && text(file.support_level);
        if (!path || !language || !support) return [];
        const limited = file.coverage_limitation === true;
        const skipped = support === "SKIP";
        const reason = text(file.skip_reason);
        return [
          {
            path,
            language,
            support_level: support,
            disposition: limited
              ? SCAN_COVERAGE_DISPOSITIONS.limited
              : skipped
                ? SCAN_COVERAGE_DISPOSITIONS.skipped
                : SCAN_COVERAGE_DISPOSITIONS.analyzed,
            limitation_refs: reason ? [`limitation:${reason}`] : [],
          },
        ];
      },
    ),
    toolOutcomes: toolOutcomes(root),
    unresolvedDynamicBoundaries: unresolvedDynamicBoundaries(root),
  };
}

function toolOutcomes(
  payload: Record<string, unknown> | null,
): ScanCoverageResponse["result"]["tool_outcomes"] {
  const versions = record(payload?.tools_version);
  const failures = Array.isArray(payload?.tool_failures)
    ? payload.tool_failures
    : [];
  const failureRows = failures.flatMap((value) => {
    const item = record(value);
    const toolName = item && text(item.tool_name);
    const outcome = item && text(item.outcome);
    if (!toolName || !outcome) return [];
    const version =
      (versions && text(versions[toolName])) ||
      (item && text(item.tool_version));
    return [
      {
        tool_name: toolName,
        tool_version: version ?? null,
        outcome,
        limitation_refs: [`tool_failure:${toolName}:${outcome.toLowerCase()}`],
      },
    ];
  });
  const seen = new Set(failureRows.map((row) => row.tool_name));
  const successRows = versions
    ? Object.entries(versions).flatMap(([toolName, version]) => {
        if (seen.has(toolName) || typeof version !== "string") return [];
        return [
          {
            tool_name: toolName,
            tool_version: version,
            outcome: "SUCCESS",
            limitation_refs: [],
          },
        ];
      })
    : [];
  return [...failureRows, ...successRows].sort((left, right) =>
    left.tool_name.localeCompare(right.tool_name),
  );
}

function unresolvedDynamicBoundaries(
  payload: Record<string, unknown> | null,
): ScanCoverageResponse["result"]["unresolved_dynamic_boundaries"] {
  return [
    ...readDynamicBoundaries(
      record(payload?.python_analysis),
      "PYTHON_ANALYSIS",
    ),
    ...readDynamicBoundaries(record(payload?.ts_js_analysis), "TS_JS_ANALYSIS"),
  ];
}

function readDynamicBoundaries(
  analysis: Record<string, unknown> | null,
  source: string,
): ScanCoverageResponse["result"]["unresolved_dynamic_boundaries"] {
  const items = Array.isArray(analysis?.unsupported_dynamic_flows)
    ? analysis.unsupported_dynamic_flows
    : [];
  return items.flatMap((value) => {
    const item = record(value);
    const filePath =
      (item && text(item.file_path)) ||
      (item && text(item.relative_path)) ||
      null;
    const symbolRef =
      (item && text(item.symbol_ref)) ||
      (item && text(item.function_name)) ||
      null;
    const reason =
      (item && text(item.reason)) ||
      (item && text(item.description)) ||
      "UNSUPPORTED_DYNAMIC_FLOW";
    const evidenceRef =
      (item && text(item.finding_ref)) ||
      (item && text(item.evidence_ref)) ||
      null;
    return [
      {
        source,
        file_path: filePath,
        symbol_ref: symbolRef,
        reason,
        evidence_ref: evidenceRef,
      },
    ];
  });
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
