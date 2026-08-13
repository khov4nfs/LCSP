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
  HUMAN_REVIEW_KINDS,
  HUMAN_REVIEW_STATES,
  type HumanReviewKind,
  type HumanReviewPathResponse,
} from "../../contracts/evidence/human-review-path.contract.js";
import { InspectHumanReviewPathQuery } from "./inspect-human-review-path.query.js";

@QueryHandler(InspectHumanReviewPathQuery)
export class InspectHumanReviewPathHandler implements IQueryHandler<
  InspectHumanReviewPathQuery,
  HumanReviewPathResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}
  async execute(
    query: InspectHumanReviewPathQuery,
  ): Promise<HumanReviewPathResponse> {
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
    const response: HumanReviewPathResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.inspectHumanReviewPath,
      tool_version: "1.0.0",
      config_hash: "sha256:human-review-path-v1",
      correlationId: query.correlationId,
      artifact_versions: { technical_evidence_report_id: report.id },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state:
        result.review_state === HUMAN_REVIEW_STATES.unknown
          ? AGENTIC_TOOL_COVERAGE_STATES.limited
          : AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: result.segments.flatMap((item) => item.evidence_refs),
      limitations:
        result.review_state === HUMAN_REVIEW_STATES.unknown
          ? [result.terminal.reason]
          : [],
      result,
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.humanReviewPathRead,
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
    review_coverage_state: unknown;
    nodes: Record<string, unknown>[];
    edges: Record<string, unknown>[];
  },
  query: InspectHumanReviewPathQuery,
): HumanReviewPathResponse["result"] {
  const nodes = new Map(
    graph.nodes.map((node) => [String(node.node_id), node]),
  );
  const seen = new Set<string>();
  const segments: HumanReviewPathResponse["result"]["segments"] = [];
  let current = query.startNodeId;
  for (let hop = 0; hop < query.maxHops; hop++) {
    if (seen.has(current)) break;
    seen.add(current);
    const node = nodes.get(current);
    if (node?.node_type === "UNSUPPORTED_FLOW")
      return {
        review_state: HUMAN_REVIEW_STATES.unknown,
        segments,
        terminal: {
          state: "DYNAMIC_BOUNDARY",
          reason: "UNSUPPORTED_DYNAMIC_FLOW",
        },
        truncated: false,
      };
    if (node?.node_type === "HUMAN_REVIEW_STEP") {
      const kind = reviewKind(node);
      if (!kind || !query.reviewKinds.includes(kind))
        return unknown(segments, "UNCLASSIFIED_REVIEW_EVIDENCE");
      segments.push({
        segment_ref: `node:${current}`,
        review_kind: kind,
        relative_location: location(node),
        evidence_refs: refs(node.evidence_refs),
      });
      return {
        review_state: HUMAN_REVIEW_STATES.present,
        segments,
        terminal: { state: "RESOLVED", reason: "REVIEW_EVIDENCE_FOUND" },
        truncated: false,
      };
    }
    const edge = graph.edges
      .filter((item) => item.source_node_id === current)
      .sort((a, b) => String(a.edge_id).localeCompare(String(b.edge_id)))[0];
    if (!edge)
      return graph.review_coverage_state === "SUFFICIENT"
        ? {
            review_state: HUMAN_REVIEW_STATES.absent,
            segments,
            terminal: { state: "RESOLVED", reason: "STATIC_SCOPE_EXHAUSTED" },
            truncated: false,
          }
        : unknown(segments, "REVIEW_COVERAGE_INSUFFICIENT");
    current = String(edge.target_node_id);
  }
  return {
    review_state: HUMAN_REVIEW_STATES.unknown,
    segments,
    terminal: { state: "HOP_LIMIT", reason: "MAX_HOPS_REACHED" },
    truncated: true,
  };
}
function unknown(
  segments: HumanReviewPathResponse["result"]["segments"],
  reason: string,
): HumanReviewPathResponse["result"] {
  return {
    review_state: HUMAN_REVIEW_STATES.unknown,
    segments,
    terminal: { state: "OUT_OF_COVERAGE", reason },
    truncated: false,
  };
}

function graphData(value: unknown): {
  review_coverage_state: unknown;
  nodes: Record<string, unknown>[];
  edges: Record<string, unknown>[];
} | null {
  const root = rec(value);
  const graph = root && rec(root.evidence_graph);
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges))
    return null;
  return {
    review_coverage_state: graph.review_coverage_state,
    nodes: graph.nodes.flatMap((item): Record<string, unknown>[] => {
      const node = rec(item);
      return node ? [node] : [];
    }),
    edges: graph.edges.flatMap((item): Record<string, unknown>[] => {
      const edge = rec(item);
      return edge ? [edge] : [];
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
function location(node: Record<string, unknown>): string | null {
  const path = typeof node.file_path === "string" ? node.file_path : null;
  return path && typeof node.line_number === "number"
    ? `${path}:${node.line_number}`
    : path;
}
function reviewKind(node: Record<string, unknown>): HumanReviewKind | null {
  const kind = node.review_kind;
  return Object.values(HUMAN_REVIEW_KINDS).includes(kind as HumanReviewKind)
    ? (kind as HumanReviewKind)
    : null;
}
