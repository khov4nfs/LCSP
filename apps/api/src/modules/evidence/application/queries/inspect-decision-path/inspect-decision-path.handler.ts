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
  DECISION_ACTION_CATEGORIES,
  type DecisionActionCategory,
  type DecisionPathResponse,
} from "../../contracts/evidence/decision-path.contract.js";
import { InspectDecisionPathQuery } from "./inspect-decision-path.query.js";

@QueryHandler(InspectDecisionPathQuery)
export class InspectDecisionPathHandler implements IQueryHandler<
  InspectDecisionPathQuery,
  DecisionPathResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}
  async execute(
    query: InspectDecisionPathQuery,
  ): Promise<DecisionPathResponse> {
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
    const result = inspect(graph, query);
    const limited = result.terminal.state !== "RESOLVED";
    const response: DecisionPathResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.inspectDecisionPath,
      tool_version: "1.0.0",
      config_hash: "sha256:decision-path-v1",
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
      eventType: AGENTIC_TOOL_EVENT_TYPES.decisionPathRead,
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
function inspect(
  graph: {
    decision_coverage_state: unknown;
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  },
  query: InspectDecisionPathQuery,
): DecisionPathResponse["result"] {
  const nodes = new Map(
    graph.nodes.map((node) => [String(node.node_id), node]),
  );
  const segments: DecisionPathResponse["result"]["segments"] = [];
  const seen = new Set<string>();
  let current = query.startNodeId;
  for (let hop = 0; hop < query.maxHops; hop++) {
    if (seen.has(current)) break;
    seen.add(current);
    const node = nodes.get(current);
    if (node?.node_type === "UNSUPPORTED_FLOW")
      return terminal(
        segments,
        "DYNAMIC_BOUNDARY",
        "UNSUPPORTED_DYNAMIC_FLOW",
        false,
      );
    if (node?.node_type === "DECISION_RULE") {
      const category = actionCategory(node);
      if (!category || !query.actionCategories.includes(category))
        return terminal(
          segments,
          "OUT_OF_COVERAGE",
          "UNCLASSIFIED_DECISION_EVIDENCE",
          false,
        );
      segments.push({
        segment_ref: `node:${current}`,
        action_category: category,
        confidence: text(node.confidence),
        from_ref: `node:${current}`,
        to_ref: `node:${current}`,
        relative_location: location(node),
        evidence_refs: refs(node.evidence_refs),
      });
      if (segments.length >= query.maxResults)
        return terminal(segments, "RESULT_LIMIT", "MAX_RESULTS_REACHED", true);
    }
    const edge = graph.edges
      .filter((item) => item.source_node_id === current)
      .sort((a, b) => String(a.edge_id).localeCompare(String(b.edge_id)))[0];
    if (!edge)
      return graph.decision_coverage_state === "SUFFICIENT"
        ? terminal(segments, "RESOLVED", "STATIC_BOUNDARY", false)
        : terminal(
            segments,
            "OUT_OF_COVERAGE",
            "DECISION_COVERAGE_INSUFFICIENT",
            false,
          );
    current = String(edge.target_node_id);
  }
  return terminal(segments, "HOP_LIMIT", "MAX_HOPS_REACHED", true);
}
function terminal(
  segments: DecisionPathResponse["result"]["segments"],
  state: string,
  reason: string,
  truncated: boolean,
): DecisionPathResponse["result"] {
  return { segments, terminal: { state, reason }, truncated };
}
function graphData(value: unknown): {
  decision_coverage_state: unknown;
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
} | null {
  const root = record(value);
  const graph = root && record(root.evidence_graph);
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    return null;
  return {
    decision_coverage_state: graph.decision_coverage_state,
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
function actionCategory(
  node: Record<string, unknown>,
): DecisionActionCategory | null {
  const category = node.action_category;
  return Object.values(DECISION_ACTION_CATEGORIES).includes(
    category as DecisionActionCategory,
  )
    ? (category as DecisionActionCategory)
    : null;
}
