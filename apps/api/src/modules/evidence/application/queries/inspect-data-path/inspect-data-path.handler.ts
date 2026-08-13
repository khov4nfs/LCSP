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
  DATA_CATEGORIES,
  DATA_PATH_DIRECTIONS,
  type DataCategory,
  type DataPathResponse,
} from "../../contracts/evidence/data-path.contract.js";
import { InspectDataPathQuery } from "./inspect-data-path.query.js";

@QueryHandler(InspectDataPathQuery)
export class InspectDataPathHandler implements IQueryHandler<
  InspectDataPathQuery,
  DataPathResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}
  async execute(query: InspectDataPathQuery): Promise<DataPathResponse> {
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
    const graph = graphData(report?.evidencePayload);
    if (
      !report ||
      !graph ||
      !graph.nodes.some((node) => node.node_id === query.startNodeId)
    )
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    const result = traverse(graph, query);
    const limited = result.terminal.state !== "RESOLVED";
    const response: DataPathResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.inspectDataPath,
      tool_version: "1.0.0",
      config_hash: "sha256:data-path-v1",
      correlationId: query.correlationId,
      artifact_versions: { technical_evidence_report_id: report.id },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: limited
        ? AGENTIC_TOOL_COVERAGE_STATES.limited
        : AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: result.segments.flatMap((item) => item.evidence_refs),
      limitations: limited ? [result.terminal.reason] : [],
      result,
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.dataPathRead,
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
        startRef: `node:${query.startNodeId}`,
      },
    });
    return response;
  }
}
function traverse(
  graph: {
    data_coverage_state: unknown;
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  },
  query: InspectDataPathQuery,
): DataPathResponse["result"] {
  const nodes = new Map(
    graph.nodes.map((node) => [String(node.node_id), node]),
  );
  const segments: DataPathResponse["result"]["segments"] = [];
  const seen = new Set<string>();
  let current = query.startNodeId;
  for (let hop = 0; hop < query.maxHops; hop++) {
    if (seen.has(current)) break;
    seen.add(current);
    const node = nodes.get(current);
    if (node?.node_type === "UNSUPPORTED_FLOW")
      return result(
        segments,
        "DYNAMIC_BOUNDARY",
        "UNSUPPORTED_DYNAMIC_FLOW",
        false,
      );
    const categories = node && dataCategories(node.data_categories);
    if (
      categories &&
      categories.some((category) => query.dataCategories.includes(category))
    ) {
      segments.push({
        segment_ref: `node:${current}`,
        role: text(node.data_role) ?? "UNKNOWN",
        categories,
        from_ref: `node:${current}`,
        to_ref: `node:${current}`,
        relative_location: location(node),
        evidence_refs: refs(node.evidence_refs),
      });
      if (segments.length >= query.maxResults)
        return result(segments, "RESULT_LIMIT", "MAX_RESULTS_REACHED", true);
    }
    const edge = graph.edges
      .filter((item) =>
        query.direction === DATA_PATH_DIRECTIONS.forward
          ? item.source_node_id === current
          : item.target_node_id === current,
      )
      .sort((a, b) => String(a.edge_id).localeCompare(String(b.edge_id)))[0];
    if (!edge)
      return graph.data_coverage_state === "SUFFICIENT"
        ? result(segments, "RESOLVED", "STATIC_BOUNDARY", false)
        : result(
            segments,
            "OUT_OF_COVERAGE",
            "DATA_COVERAGE_INSUFFICIENT",
            false,
          );
    current = String(
      query.direction === DATA_PATH_DIRECTIONS.forward
        ? edge.target_node_id
        : edge.source_node_id,
    );
  }
  return result(segments, "HOP_LIMIT", "MAX_HOPS_REACHED", true);
}
function result(
  segments: DataPathResponse["result"]["segments"],
  state: string,
  reason: string,
  truncated: boolean,
): DataPathResponse["result"] {
  return { segments, terminal: { state, reason }, truncated };
}
function graphData(value: unknown): {
  data_coverage_state: unknown;
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
} | null {
  const root = record(value);
  const graph = root && record(root.evidence_graph);
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    return null;
  return {
    data_coverage_state: graph.data_coverage_state,
    nodes: graph.nodes.flatMap((value): Record<string, unknown>[] => {
      const node = record(value);
      return node ? [node] : [];
    }),
    edges: graph.edges.flatMap((value): Record<string, unknown>[] => {
      const edge = record(value);
      return edge ? [edge] : [];
    }),
  };
}
function dataCategories(value: unknown): DataCategory[] | null {
  return Array.isArray(value) &&
    value.every((item) =>
      Object.values(DATA_CATEGORIES).includes(item as DataCategory),
    )
    ? (value as DataCategory[])
    : null;
}
function record(value: unknown): Record<string, unknown> | null {
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
function location(node: Record<string, unknown>): string | null {
  const path = text(node.file_path);
  return path && typeof node.line_number === "number"
    ? `${path}:${node.line_number}`
    : path;
}
