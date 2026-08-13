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
  EVIDENCE_SUBGRAPH_DIRECTIONS,
  type EvidenceSubgraphResponse,
} from "../../contracts/evidence/evidence-subgraph.contract.js";
import { GetEvidenceSubgraphQuery } from "./get-evidence-subgraph.query.js";

const TOOL_VERSION = "1.0.0";
const TOOL_CONFIG_HASH = "sha256:evidence-subgraph-v1";

@QueryHandler(GetEvidenceSubgraphQuery)
export class GetEvidenceSubgraphHandler implements IQueryHandler<
  GetEvidenceSubgraphQuery,
  EvidenceSubgraphResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}

  async execute(
    query: GetEvidenceSubgraphQuery,
  ): Promise<EvidenceSubgraphResponse> {
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
    const graph = graphPayload(report.evidencePayload);
    if (!graph)
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    const safeNodes = graph.nodes.filter(safeNode);
    const seed = safeNodes.find((node) => node.node_id === query.seedNodeId);
    if (!seed)
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );

    // Keep the explicit seed as the traversal anchor even when nodeTypes is used;
    // every discovered neighbor must satisfy the selector.
    const nodes = safeNodes.filter(
      (node) =>
        node.node_id === query.seedNodeId ||
        query.nodeTypes.length === 0 ||
        query.nodeTypes.includes(String(node.node_type)),
    );
    const allowedNodeIds = new Set(nodes.map((node) => String(node.node_id)));
    const edges = graph.edges
      .filter(safeEdge)
      .filter(
        (edge) =>
          (query.edgeTypes.length === 0 ||
            query.edgeTypes.includes(String(edge.edge_type))) &&
          allowedNodeIds.has(String(edge.source_node_id)) &&
          allowedNodeIds.has(String(edge.target_node_id)),
      );
    const traversal = bfs(nodes, edges, query);
    const response: EvidenceSubgraphResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.getEvidenceSubgraph,
      tool_version: TOOL_VERSION,
      config_hash: TOOL_CONFIG_HASH,
      correlation_id: query.correlationId,
      artifact_versions: {
        technical_evidence_report_id: report.id,
        evidence_graph_id: graph.graph_id,
      },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: traversal.truncated
        ? AGENTIC_TOOL_COVERAGE_STATES.limited
        : AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: traversal.nodes.flatMap((node) =>
        refs(node.evidence_refs),
      ),
      limitations: traversal.truncated ? ["GRAPH_TRAVERSAL_LIMIT_REACHED"] : [],
      result: {
        nodes: traversal.nodes.sort(byNode).map(projectNode),
        edges: traversal.edges.sort(byEdge).map(projectEdge),
        traversal: { visited_depth: traversal.depth },
        truncated: traversal.truncated,
      },
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.evidenceSubgraphRead,
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
        seedRef: `node:${query.seedNodeId}`,
        nodeTypes: query.nodeTypes,
        edgeTypes: query.edgeTypes,
      },
    });
    return response;
  }
}

function bfs(
  nodes: Record<string, unknown>[],
  edges: Record<string, unknown>[],
  query: GetEvidenceSubgraphQuery,
) {
  const selectedNodes: Record<string, unknown>[] = [];
  const selectedEdges: Record<string, unknown>[] = [];
  const seen = new Set<string>();
  let frontier = [query.seedNodeId];
  let depth = 0;
  let truncated = false;
  const byId = new Map(nodes.map((node) => [node.node_id as string, node]));
  while (frontier.length > 0 && depth <= query.maxDepth) {
    const next: string[] = [];
    for (const id of frontier.sort()) {
      if (seen.has(id)) continue;
      const node = byId.get(id);
      if (!node) continue;
      if (selectedNodes.length >= query.maxNodes) {
        truncated = true;
        break;
      }
      seen.add(id);
      selectedNodes.push(node);
      if (depth === query.maxDepth) continue;
      for (const edge of edges) {
        const source = edge.source_node_id;
        const target = edge.target_node_id;
        const followsOut =
          query.direction !== EVIDENCE_SUBGRAPH_DIRECTIONS.inbound &&
          source === id;
        const followsIn =
          query.direction !== EVIDENCE_SUBGRAPH_DIRECTIONS.outbound &&
          target === id;
        if (!followsOut && !followsIn) continue;
        if (selectedEdges.length >= query.maxEdges) {
          truncated = true;
          break;
        }
        selectedEdges.push(edge);
        next.push((followsOut ? target : source) as string);
      }
    }
    if (truncated) break;
    frontier = next;
    depth += 1;
  }
  return {
    nodes: selectedNodes,
    edges: dedupeEdges(selectedEdges),
    depth: Math.min(depth, query.maxDepth),
    truncated,
  };
}

function graphPayload(payload: unknown): {
  graph_id: string;
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
} | null {
  const root = record(payload);
  const graph = root && record(root.evidence_graph);
  const graphId = graph && text(graph.graph_id);
  return graph &&
    graphId &&
    Array.isArray(graph.nodes) &&
    Array.isArray(graph.edges)
    ? {
        graph_id: graphId,
        nodes: graph.nodes.flatMap((node): Record<string, unknown>[] => {
          const normalized = record(node);
          return normalized ? [normalized] : [];
        }),
        edges: graph.edges.flatMap((edge): Record<string, unknown>[] => {
          const normalized = record(edge);
          return normalized ? [normalized] : [];
        }),
      }
    : null;
}
function safeNode(node: Record<string, unknown>): boolean {
  return (
    text(node.node_id) !== null &&
    text(node.node_type) !== null &&
    text(node.label) !== null &&
    !containsUnsafe(node)
  );
}
function safeEdge(edge: Record<string, unknown>): boolean {
  return (
    text(edge.edge_id) !== null &&
    text(edge.edge_type) !== null &&
    text(edge.source_node_id) !== null &&
    text(edge.target_node_id) !== null &&
    !containsUnsafe(edge)
  );
}
function projectNode(node: Record<string, unknown>) {
  const path = text(node.file_path);
  const line = node.line_number;
  return {
    node_ref: `node:${text(node.node_id)}`,
    type: text(node.node_type)!,
    label: text(node.label)!,
    relative_location:
      path && typeof line === "number" ? `${path}:${line}` : path,
    evidence_refs: refs(node.evidence_refs),
  };
}
function projectEdge(edge: Record<string, unknown>) {
  return {
    edge_ref: `edge:${text(edge.edge_id)}`,
    type: text(edge.edge_type)!,
    from_ref: `node:${text(edge.source_node_id)}`,
    to_ref: `node:${text(edge.target_node_id)}`,
    evidence_refs: refs(edge.evidence_refs),
  };
}
function containsUnsafe(value: unknown): boolean {
  if (typeof value === "string")
    return /\b(gh[oprsu]_[A-Za-z0-9_]{20,}|sk-ant-[A-Za-z0-9_-]{16,}|AKIA[A-Z0-9]{16})\b/.test(
      value,
    );
  if (Array.isArray(value)) return value.some(containsUnsafe);
  const objectValue = record(value);
  return (
    objectValue !== null &&
    Object.entries(objectValue).some(
      ([key, item]) =>
        /^(source_code|raw_source|prompt|full_ast|ast_body|secret|token)$/i.test(
          key,
        ) || containsUnsafe(item),
    )
  );
}
function dedupeEdges(
  edges: Record<string, unknown>[],
): Record<string, unknown>[] {
  return [
    ...new Map(edges.map((edge) => [edge.edge_id as string, edge])).values(),
  ];
}
function refs(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}
function byNode(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  return (text(left.node_id) ?? "").localeCompare(text(right.node_id) ?? "");
}
function byEdge(
  left: Record<string, unknown>,
  right: Record<string, unknown>,
): number {
  return (text(left.edge_id) ?? "").localeCompare(text(right.edge_id) ?? "");
}
function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
