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
  SYMBOL_CONTEXT_INCLUDES,
  type SymbolContextResponse,
} from "../../contracts/evidence/symbol-context.contract.js";
import { GetSymbolContextQuery } from "./get-symbol-context.query.js";

const SYMBOL_TYPES = new Set([
  "FUNCTION",
  "METHOD",
  "CLASS",
  "CONTROLLER",
  "ROUTE",
]);
@QueryHandler(GetSymbolContextQuery)
export class GetSymbolContextHandler implements IQueryHandler<
  GetSymbolContextQuery,
  SymbolContextResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}
  async execute(query: GetSymbolContextQuery): Promise<SymbolContextResponse> {
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
    const symbol = graph?.nodes.find(
      (node) =>
        node.node_id === query.symbolNodeId &&
        SYMBOL_TYPES.has(string(node.node_type) ?? ""),
    );
    if (!graph || !symbol)
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    const neighbors = graph.edges
      .filter(
        (edge) =>
          edge.source_node_id === query.symbolNodeId ||
          edge.target_node_id === query.symbolNodeId,
      )
      .sort((a, b) => string(a.edge_id)!.localeCompare(string(b.edge_id)!));
    const truncated = neighbors.length > query.maxNeighbors;
    const selected = neighbors.slice(0, query.maxNeighbors);
    const result: Record<string, unknown> = {
      symbol_ref: `symbol:${query.symbolNodeId}`,
      kind: string(symbol.node_type),
      relative_location: location(symbol),
    };
    if (query.include.includes(SYMBOL_CONTEXT_INCLUDES.categories))
      result.categories = [string(symbol.node_type)].filter(Boolean);
    if (query.include.includes(SYMBOL_CONTEXT_INCLUDES.callers))
      result.callers = selected
        .filter((edge) => edge.target_node_id === query.symbolNodeId)
        .flatMap((edge) => {
          const source = string(edge.source_node_id);
          return source ? [`symbol:${source}`] : [];
        })
        .sort();
    if (query.include.includes(SYMBOL_CONTEXT_INCLUDES.callees))
      result.callees = selected
        .filter((edge) => edge.source_node_id === query.symbolNodeId)
        .flatMap((edge) => {
          const target = string(edge.target_node_id);
          return target ? [`symbol:${target}`] : [];
        })
        .sort();
    if (query.include.includes(SYMBOL_CONTEXT_INCLUDES.evidenceRefs))
      result.evidence_refs = refs(symbol.evidence_refs);
    const response: SymbolContextResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.getSymbolContext,
      tool_version: "1.0.0",
      config_hash: "sha256:symbol-context-v1",
      correlationId: query.correlationId,
      artifact_versions: { technical_evidence_report_id: report.id },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: truncated
        ? AGENTIC_TOOL_COVERAGE_STATES.limited
        : AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: refs(symbol.evidence_refs),
      limitations: truncated ? ["SYMBOL_NEIGHBOR_LIMIT_REACHED"] : [],
      result: { symbol: result, truncated },
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.symbolContextRead,
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
        symbolRef: `symbol:${query.symbolNodeId}`,
      },
    });
    return response;
  }
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
      const safe = rec(node);
      return safe ? [safe] : [];
    }),
    edges: graph.edges.flatMap((edge): Record<string, unknown>[] => {
      const safe = rec(edge);
      return safe ? [safe] : [];
    }),
  };
}
function rec(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function string(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
function refs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
function location(node: Record<string, unknown>): string | null {
  const path = string(node.file_path);
  const line = node.line_number;
  return path && typeof line === "number" ? `${path}:${line}` : path;
}
