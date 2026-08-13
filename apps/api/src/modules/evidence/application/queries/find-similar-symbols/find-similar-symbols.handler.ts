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
  type SimilarSymbolsResponse,
  type SymbolSimilarityDimension,
} from "../../contracts/evidence/similar-symbols.contract.js";
import { FindSimilarSymbolsQuery } from "./find-similar-symbols.query.js";
@QueryHandler(FindSimilarSymbolsQuery)
export class FindSimilarSymbolsHandler implements IQueryHandler<
  FindSimilarSymbolsQuery,
  SimilarSymbolsResponse
> {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditWriter: AuditWriterService,
  ) {}
  async execute(
    query: FindSimilarSymbolsQuery,
  ): Promise<SimilarSymbolsResponse> {
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
    const nodes = nodesFrom(report?.evidencePayload);
    const seed = nodes?.find((node) => node.node_id === query.seedNodeId);
    if (!report || !nodes || !seed)
      throw problemException(
        EVIDENCE_ERROR_CODES.notFound,
        query.correlationId,
        { status: HttpStatus.NOT_FOUND },
      );
    const candidates = nodes
      .filter((node) => node.node_id !== seed.node_id)
      .filter(
        (node) =>
          query.pathPrefixes.length === 0 ||
          (node.file_path !== null &&
            query.pathPrefixes.some((prefix) =>
              node.file_path!.startsWith(prefix),
            )),
      )
      .map((node) => candidate(seed, node, query.dimensions))
      .filter((item): item is NonNullable<typeof item> => item !== null)
      .sort(
        (a, b) => b.score - a.score || a.symbol_ref.localeCompare(b.symbol_ref),
      );
    const selected = candidates.slice(0, query.maxResults);
    const response: SimilarSymbolsResponse = {
      status: AGENTIC_TOOL_STATUSES.ready,
      tool_name: AGENTIC_TOOL_NAMES.findSimilarSymbols,
      tool_version: "1.0.0",
      config_hash: "sha256:fingerprint-v1",
      correlation_id: query.correlationId,
      artifact_versions: { technical_evidence_report_id: report.id },
      provenance_ref: `tool-execution:${query.correlationId}`,
      coverage_state: AGENTIC_TOOL_COVERAGE_STATES.sufficient,
      evidence_refs: selected.flatMap((item) => item.evidence_refs),
      limitations: [],
      result: {
        algorithm_version: "fingerprint-v1",
        candidates: selected,
        truncated: candidates.length > selected.length,
      },
    };
    await this.auditWriter.write({
      eventType: AGENTIC_TOOL_EVENT_TYPES.similarSymbolsRead,
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
        pathPrefixes: query.pathPrefixes,
      },
    });
    return response;
  }
}
type Node = {
  node_id: string;
  node_type: string;
  file_path: string | null;
  line_number: number | null;
  evidence_refs: string[];
  fingerprint: Record<string, unknown>;
};
function nodesFrom(payload: unknown): Node[] | null {
  const root = rec(payload);
  const graph = root && rec(root.evidence_graph);
  if (!graph || !Array.isArray(graph.nodes)) return null;
  return graph.nodes.flatMap((value): Node[] => {
    const node = rec(value);
    const id = node && text(node.node_id);
    const type = node && text(node.node_type);
    if (!id || !type) return [];
    return [
      {
        node_id: id,
        node_type: type,
        file_path: text(node.file_path),
        line_number:
          typeof node.line_number === "number" ? node.line_number : null,
        evidence_refs: refs(node.evidence_refs),
        fingerprint: rec(node.fingerprint) ?? {},
      },
    ];
  });
}
function candidate(
  seed: Node,
  node: Node,
  dimensions: SymbolSimilarityDimension[],
): SimilarSymbolsResponse["result"]["candidates"][number] | null {
  const matched = dimensions.filter(
    (dimension) =>
      JSON.stringify(seed.fingerprint[dimension]) ===
        JSON.stringify(node.fingerprint[dimension]) &&
      seed.fingerprint[dimension] !== undefined,
  );
  if (!matched.length) return null;
  return {
    symbol_ref: `symbol:${node.node_id}`,
    score: matched.length / dimensions.length,
    matched_dimensions: matched,
    relative_location:
      node.file_path && node.line_number
        ? `${node.file_path}:${node.line_number}`
        : node.file_path,
    evidence_refs: node.evidence_refs,
  };
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
