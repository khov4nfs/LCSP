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
  PROVIDER_INVOCATION_FRAMEWORKS,
  PROVIDER_INVOCATION_PROVIDERS,
  type ProviderInvocationFramework,
  type ProviderInvocationProvider,
  type ProviderInvocationResponse,
} from "../../contracts/evidence/provider-invocation.contract.js";
import { FindProviderInvocationsQuery } from "./find-provider-invocations.query.js";

const TOOL_VERSION = "1.0.0";
const TOOL_CONFIG_HASH = "sha256:provider-invocation-v1";

@QueryHandler(FindProviderInvocationsQuery)
export class FindProviderInvocationsHandler implements IQueryHandler<
  FindProviderInvocationsQuery,
  ProviderInvocationResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: FindProviderInvocationsQuery,
  ): Promise<ProviderInvocationResponse> {
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
    if (!report)
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    const payload = asRecord(report.evidencePayload);
    const invocations = (
      Array.isArray(payload?.technical_findings)
        ? payload.technical_findings
        : []
    )
      .filter(record)
      .filter((finding) => invocation(finding, query))
      .sort((left, right) => location(left).localeCompare(location(right)))
      .slice(0, query.maxResults + 1);
    const truncated = invocations.length > query.maxResults;
    const coverageLimited = scopeCoverageLimited(
      report.evidencePayload,
      query.pathPrefixes,
    );
    const results = invocations.slice(0, query.maxResults).map((finding) => {
      const id = text(finding.finding_id) ?? "";
      return {
        invocation_ref: `invocation:${id}`,
        provider: provider(finding)!,
        framework: framework(finding),
        relative_location: location(finding) || null,
        symbol_ref: null,
        evidence_refs: [`finding:${id}`],
      };
    });
    const declaredSignals = (
      Array.isArray(payload?.package_dependencies)
        ? payload.package_dependencies
        : []
    )
      .filter(record)
      .filter((dependency) => dependency.is_ai_relevant === true)
      .flatMap((dependency) => {
        const name = text(dependency.name);
        return name
          ? [{ kind: "DEPENDENCY_SIGNAL", ref: `dependency:${name}` }]
          : [];
      });
    const configuredSignals = deploymentSignals(
      payload,
      query.provider,
      query.pathPrefixes,
    );
    const response: ProviderInvocationResponse = {
      status:
        results.length === 0 && coverageLimited
          ? AGENTIC_TOOL_STATUSES.outOfCoverage
          : AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.findProviderInvocations,
      tool_version: TOOL_VERSION,
      config_hash: TOOL_CONFIG_HASH,
      correlationId: query.correlationId,
      artifact_versions: { technical_evidence_report_id: report.id },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: coverageLimited
        ? AGENTIC_TOOL_COVERAGE_STATES.limited
        : AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: results.flatMap((item) => item.evidence_refs),
      limitations: [
        ...(coverageLimited ? ["SCAN_COVERAGE_LIMITATION"] : []),
        ...(truncated ? ["RESULT_LIMIT_REACHED"] : []),
      ],
      result: {
        invocations: results,
        declared_signals: declaredSignals,
        configured_signals: configuredSignals,
        searched_scope: {
          artifact_version: report.id,
          provider: query.provider ?? null,
          framework: query.framework ?? null,
          path_prefixes: query.pathPrefixes,
          exhaustive: !coverageLimited && !truncated,
        },
        truncated,
      },
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.providerInvocationRead,
      actorId: null,
      organizationId: query.organizationId,
      assessmentId: query.assessmentId,
      resourceType: AUDIT_RESOURCE_TYPES.technicalEvidenceReport,
      resourceId: report.id,
      correlationId: query.correlationId,
      decision: AUDIT_DECISIONS.allow,
      result: response.status,
      payload: { toolName: response.tool_name, resultCount: results.length },
    });
    return response;
  }
}

function invocation(
  finding: Record<string, unknown>,
  query: FindProviderInvocationsQuery,
): boolean {
  const kind = text(finding.finding_type);
  const findingProvider = provider(finding);
  const findingFramework = framework(finding);
  const path = text(finding.file_path);
  return (
    kind !== null &&
    kind.includes("AI_PROVIDER") &&
    findingProvider !== null &&
    (query.provider === undefined || query.provider === findingProvider) &&
    (query.framework === undefined || query.framework === findingFramework) &&
    (query.pathPrefixes.length === 0 ||
      (path !== null &&
        query.pathPrefixes.some((prefix) => path.startsWith(prefix))))
  );
}

function provider(
  finding: Record<string, unknown>,
): ProviderInvocationProvider | null {
  const library = text(finding.library_group)?.toUpperCase();
  if (!library) return null;
  if (library.includes("OPENAI")) return PROVIDER_INVOCATION_PROVIDERS.openai;
  if (library.includes("ANTHROPIC"))
    return PROVIDER_INVOCATION_PROVIDERS.anthropic;
  if (library.includes("GOOGLE") || library.includes("GEMINI"))
    return PROVIDER_INVOCATION_PROVIDERS.google;
  if (library.includes("AZURE"))
    return PROVIDER_INVOCATION_PROVIDERS.azureOpenai;
  return PROVIDER_INVOCATION_PROVIDERS.other;
}

function framework(
  finding: Record<string, unknown>,
): ProviderInvocationFramework | null {
  const library = text(finding.library_group)?.toUpperCase();
  if (!library) return null;
  if (library.includes("LANGCHAIN"))
    return PROVIDER_INVOCATION_FRAMEWORKS.langchain;
  if (library.includes("LANGGRAPH"))
    return PROVIDER_INVOCATION_FRAMEWORKS.langgraph;
  if (library.includes("GOOGLE") || library.includes("GEMINI"))
    return PROVIDER_INVOCATION_FRAMEWORKS.genaiSdk;
  if (library.includes("OPENAI"))
    return PROVIDER_INVOCATION_FRAMEWORKS.openaiSdk;
  return PROVIDER_INVOCATION_FRAMEWORKS.other;
}
function location(finding: Record<string, unknown>): string {
  const path = text(finding.file_path) ?? "";
  const line = finding.line_number;
  return typeof line === "number" && Number.isInteger(line) && line > 0
    ? `${path}:${line}`
    : path;
}
function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function asRecord(value: unknown): Record<string, unknown> | null {
  return record(value) ? value : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function scopeCoverageLimited(
  payload: unknown,
  pathPrefixes: string[],
): boolean {
  const root = asRecord(payload);
  const coverage = asRecord(root?.scan_coverage);
  const files = Array.isArray(coverage?.files) ? coverage.files : [];
  return files.some((item) => {
    if (!record(item)) return false;
    const path = text(item.file_path);
    if (!path || item.coverage_limitation !== true) return false;
    if (pathPrefixes.length === 0) return true;
    return pathPrefixes.some((prefix) => path.startsWith(prefix));
  });
}

function deploymentSignals(
  payload: Record<string, unknown> | null,
  providerFilter: ProviderInvocationProvider | undefined,
  pathPrefixes: string[],
): Array<{ kind: string; ref: string }> {
  const contexts = Array.isArray(payload?.deployment_contexts)
    ? payload.deployment_contexts
    : [];
  return contexts.flatMap((item) => {
    if (!record(item)) return [];
    const ref = text(item.context_ref);
    const path = text(item.relative_location);
    const provider = text(item.provider)?.toUpperCase();
    if (!ref || !path) return [];
    if (
      pathPrefixes.length > 0 &&
      !pathPrefixes.some((prefix) => path.startsWith(prefix))
    ) {
      return [];
    }
    if (providerFilter && provider !== providerFilter) {
      return [];
    }
    return [{ kind: "CONFIG_SIGNAL", ref: `deployment:${ref}` }];
  });
}
