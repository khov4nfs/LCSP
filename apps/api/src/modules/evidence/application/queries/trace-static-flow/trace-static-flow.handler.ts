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
  STATIC_FLOW_DIRECTIONS,
  STATIC_FLOW_TERMINALS,
  type StaticFlowResponse,
} from "../../contracts/evidence/static-flow.contract.js";
import { TraceStaticFlowQuery } from "./trace-static-flow.query.js";
@QueryHandler(TraceStaticFlowQuery)
export class TraceStaticFlowHandler implements IQueryHandler<
  TraceStaticFlowQuery,
  StaticFlowResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}
  async execute(query: TraceStaticFlowQuery): Promise<StaticFlowResponse> {
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
    const graph = graphData(report.evidencePayload);
    if (
      !graph ||
      !graph.nodes.some((node) => node.node_id === query.startNodeId)
    )
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    const trace = follow(graph, query);
    const response: StaticFlowResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.traceStaticFlow,
      tool_version: "1.0.0",
      config_hash: "sha256:static-flow-v1",
      correlation_id: query.correlationId,
      artifact_versions: { technical_evidence_report_id: report.id },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state:
        trace.terminal.state === STATIC_FLOW_TERMINALS.resolved
          ? AGENTIC_TOOL_COVERAGE_STATES.sufficient
          : AGENTIC_TOOL_COVERAGE_STATES.limited,
      evidence_refs: trace.segments.flatMap((item) => item.evidence_refs),
      limitations:
        trace.terminal.state === STATIC_FLOW_TERMINALS.resolved
          ? []
          : [trace.terminal.reason],
      result: trace,
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.staticFlowRead,
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
function follow(
  graph: { nodes: Record<string, unknown>[]; edges: Record<string, unknown>[] },
  query: TraceStaticFlowQuery,
) {
  const nodes = new Map(
    graph.nodes.map((node) => [node.node_id as string, node]),
  );
  const seen = new Set<string>();
  const segments: StaticFlowResponse["result"]["segments"] = [];
  let current = query.startNodeId;
  let terminal: StaticFlowResponse["result"]["terminal"] = {
    state: STATIC_FLOW_TERMINALS.resolved,
    reason: "NO_FURTHER_STATIC_EDGE",
    ref: null as string | null,
  };
  for (let hop = 0; hop < query.maxHops; hop++) {
    if (seen.has(current)) {
      terminal = {
        state: STATIC_FLOW_TERMINALS.resolved,
        reason: "CYCLE_STOP",
        ref: `node:${current}`,
      };
      break;
    }
    seen.add(current);
    const currentNode = nodes.get(current);
    if (currentNode?.node_type === "UNSUPPORTED_FLOW") {
      terminal = {
        state: STATIC_FLOW_TERMINALS.dynamicBoundary,
        reason: "UNSUPPORTED_DYNAMIC_FLOW",
        ref: `node:${current}`,
      };
      break;
    }
    const edge = graph.edges
      .filter((item) =>
        query.direction === STATIC_FLOW_DIRECTIONS.forward
          ? item.source_node_id === current
          : item.target_node_id === current,
      )
      .sort((a, b) => String(a.edge_id).localeCompare(String(b.edge_id)))[0];
    if (!edge) break;
    const next = (
      query.direction === STATIC_FLOW_DIRECTIONS.forward
        ? edge.target_node_id
        : edge.source_node_id
    ) as string;
    segments.push({
      segment_ref: `flow:${edge.edge_id as string}`,
      stage: String(edge.edge_type),
      from_ref: `node:${edge.source_node_id as string}`,
      to_ref: `node:${edge.target_node_id as string}`,
      relative_location: location(currentNode),
      evidence_refs: refs(edge.evidence_refs),
    });
    current = next;
    if (hop === query.maxHops - 1)
      terminal = {
        state: STATIC_FLOW_TERMINALS.hopLimit,
        reason: "MAX_HOPS_REACHED",
        ref: `node:${current}`,
      };
  }
  return {
    segments,
    terminal,
    truncated: terminal.state === STATIC_FLOW_TERMINALS.hopLimit,
  };
}
function graphData(value: unknown): {
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
} | null {
  const root = rec(value);
  const graph = root && rec(root.evidence_graph);
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    return null;
  return {
    nodes: graph.nodes.flatMap((node): Record<string, unknown>[] => {
      const item = rec(node);
      return item ? [item] : [];
    }),
    edges: graph.edges.flatMap((edge): Record<string, unknown>[] => {
      const item = rec(edge);
      return item ? [item] : [];
    }),
  };
}
function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function refs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
function location(node: Record<string, unknown> | undefined): string | null {
  const path = typeof node?.file_path === "string" ? node.file_path : null;
  return path && typeof node?.line_number === "number"
    ? `${path}:${node.line_number}`
    : path;
}
