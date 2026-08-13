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
  DEPLOYMENT_ENVIRONMENTS,
  DEPLOYMENT_MANIFEST_KINDS,
  type DeploymentContextResponse,
} from "../../contracts/evidence/deployment-context.contract.js";
import { InspectDeploymentContextQuery } from "./inspect-deployment-context.query.js";
@QueryHandler(InspectDeploymentContextQuery)
export class InspectDeploymentContextHandler implements IQueryHandler<
  InspectDeploymentContextQuery,
  DeploymentContextResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}
  async execute(
    query: InspectDeploymentContextQuery,
  ): Promise<DeploymentContextResponse> {
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
    const contexts = contextsFrom(report?.evidencePayload);
    if (!report || !contexts)
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    const cursorKey = query.cursor ? decodeCursor(query.cursor) : null;
    const candidates = contexts
      .filter(
        (item) =>
          (query.manifestKinds.length === 0 ||
            query.manifestKinds.includes(item.manifest_kind)) &&
          (query.environments.length === 0 ||
            query.environments.includes(item.environment)) &&
          (query.pathPrefixes.length === 0 ||
            query.pathPrefixes.some((prefix) =>
              item.relative_location.startsWith(prefix),
            )),
      )
      .sort((a, b) => contextKey(a).localeCompare(contextKey(b)));
    const afterCursor = cursorKey
      ? candidates.filter((item) => contextKey(item) > cursorKey)
      : candidates;
    const page = afterCursor.slice(0, query.maxResults + 1);
    const truncated = page.length > query.maxResults;
    const selected = page.slice(0, query.maxResults);
    const nextCursor =
      truncated && selected.length > 0
        ? encodeCursor(contextKey(selected[selected.length - 1]))
        : null;
    const response: DeploymentContextResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.inspectDeploymentContext,
      tool_version: "1.0.0",
      config_hash: "sha256:deployment-v1",
      correlation_id: query.correlationId,
      artifact_versions: { technical_evidence_report_id: report.id },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: selected.flatMap((item) => item.evidence_refs),
      limitations: truncated ? ["RESULT_LIMIT_REACHED"] : [],
      result: {
        contexts: selected,
        next_cursor: nextCursor,
        truncated,
      },
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.deploymentContextRead,
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
        pathPrefixes: query.pathPrefixes,
        resultCount: selected.length,
        truncated,
      },
    });
    return response;
  }
}
function contextsFrom(
  payload: unknown,
): DeploymentContextResponse["result"]["contexts"] | null {
  const root = rec(payload);
  const values = root?.deployment_contexts;
  if (!Array.isArray(values)) return null;
  return values.flatMap(
    (value): DeploymentContextResponse["result"]["contexts"] => {
      const item = rec(value);
      const ref = item && text(item.context_ref);
      const kind = item && text(item.manifest_kind);
      const environment = item && text(item.environment);
      const location = item && text(item.relative_location);
      const categories = item?.categories;
      if (
        !ref ||
        !kind ||
        !environment ||
        !location ||
        !Array.isArray(categories) ||
        !Object.values(DEPLOYMENT_MANIFEST_KINDS).includes(kind as never) ||
        !Object.values(DEPLOYMENT_ENVIRONMENTS).includes(
          environment as never,
        ) ||
        !categories.every((item) => typeof item === "string")
      )
        return [];
      return [
        {
          context_ref: ref,
          manifest_kind: kind as never,
          environment: environment as never,
          relative_location: location,
          categories,
          evidence_refs: refs(item.evidence_refs),
        },
      ];
    },
  );
}
function contextKey(
  item: DeploymentContextResponse["result"]["contexts"][number],
): string {
  return `${item.relative_location}\u0000${item.context_ref}`;
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
function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}
function refs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
