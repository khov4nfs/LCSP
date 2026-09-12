import { Injectable } from "@nestjs/common";

import { isRecord } from "../../../../../common/utils/index.js";
import type {
  ProgramEvidenceGraphClaimDto,
  ProgramEvidenceGraphDetailDto,
  ProgramEvidenceGraphEdgeDto,
  ProgramEvidenceGraphNodeDto,
  ProgramEvidenceGraphFindingDto,
  ProgramEvidenceGraphSourceDto,
} from "../../contracts/evidence/program-evidence-graph-detail.contract.js";
import { ArtifactStorageService } from "../../../../../platform/storage/artifact-storage.service.js";

const MAX_PROJECTED_NODES = 240;
const MAX_PROJECTED_EDGES = 480;

@Injectable()
export class ProgramEvidenceGraphDetailService {
  constructor(
    private readonly storage: ArtifactStorageService = new ArtifactStorageService(),
  ) {}

  async project(input: {
    report: {
      id: string;
      assessmentId: string;
      scanJobId: string;
      snapshotId: string;
      evidencePayload: unknown;
      createdAt: Date;
    };
    snapshot: {
      repositoryFullName: string;
      branch: string | null;
      ref: string | null;
      commitSha: string;
      status: string;
    } | null;
  }): Promise<ProgramEvidenceGraphDetailDto> {
    const payload = record(input.report.evidencePayload);
    const graph = record(payload?.evidence_graph ?? payload?.evidenceGraph);
    let artifact: Record<string, unknown> | null = null;
    const graphRef = text(graph?.evidence_graph_ref ?? graph?.evidenceGraphRef);
    if (graphRef) {
      try {
        artifact = await this.storage.readJsonArtifactReference(graphRef);
      } catch {
        artifact = null;
      }
    }
    const sourceGraph = artifact ?? graph;
    const { nodes, edges } = boundedGraph(
      graphNodes(sourceGraph?.nodes),
      graphEdges(sourceGraph?.edges),
    );

    return {
      repository: {
        repository_full_name: input.snapshot?.repositoryFullName ?? null,
        branch: input.snapshot?.branch ?? null,
        ref: input.snapshot?.ref ?? null,
        pinned_commit: input.snapshot?.commitSha ?? null,
        status: input.snapshot?.status ?? null,
      },
      overview: {
        modules_analyzed: metric(payload, [
          "modulesAnalyzed",
          "modules_analyzed",
        ]),
        code_symbols_indexed: metric(payload, [
          "codeSymbolsIndexed",
          "code_symbols_indexed",
        ]),
        ai_model_invocations: metric(payload, [
          "aiModelInvocations",
          "ai_model_invocations",
        ]),
        evidence_mapped_scope: metric(payload, [
          "evidenceMappedScope",
          "evidenceMappedScopePercent",
          "evidence_mapped_scope",
          "evidence_mapped_scope_percent",
        ]),
      },
      paths: { nodes, edges },
      claims: claims(
        payload?.claims ?? payload?.evidence_claims ?? payload?.evidenceClaims,
      ),
      provenance: {
        evidence_report_id: input.report.id,
        snapshot_id: input.report.snapshotId,
        scan_job_id: input.report.scanJobId,
        generated_at: input.report.createdAt.toISOString(),
        finding: provenanceFinding(
          claims(
            payload?.claims ??
              payload?.evidence_claims ??
              payload?.evidenceClaims,
          ),
        ),
        source: provenanceSource(sourceGraph),
      },
    };
  }
}

function provenanceFinding(
  value: unknown,
): ProgramEvidenceGraphFindingDto | null {
  const claim = claims(value)[0];
  if (!claim) return null;
  return {
    meaning: claim.meaning,
    evidence_reference: claim.evidence_refs.find(isSafeReference) ?? null,
    source: {
      file: claim.file,
      symbol: claim.symbol,
      start_line: claim.line,
      end_line: claim.line,
      evidence_reference: claim.evidence_refs.find(isSafeReference) ?? null,
    },
  };
}

function provenanceSource(
  graph: Record<string, unknown> | null,
): ProgramEvidenceGraphSourceDto | null {
  const candidates = Array.isArray(graph?.nodes)
    ? graph.nodes.flatMap((entry) => {
        const node = record(entry);
        const source = record(node?.source);
        const file = safePath(source?.file_path ?? source?.filePath);
        if (!file || file === "<workspace>") return [];
        return [
          {
            file,
            symbol: text(source?.symbol_ref ?? source?.symbolRef),
            start_line: line(
              source?.start_line ??
                source?.startLine ??
                source?.line_number ??
                source?.lineNumber,
            ),
            end_line: line(
              source?.end_line ??
                source?.endLine ??
                source?.line_number ??
                source?.lineNumber,
            ),
            evidence_reference:
              strings(node?.evidence_refs ?? node?.evidenceRefs).find(
                isSafeReference,
              ) ?? null,
          },
        ];
      })
    : [];
  return (
    candidates.sort(
      (left, right) =>
        left.file.localeCompare(right.file) ||
        (left.start_line ?? 0) - (right.start_line ?? 0) ||
        (left.symbol ?? "").localeCompare(right.symbol ?? ""),
    )[0] ?? null
  );
}

function boundedGraph(
  nodes: ProgramEvidenceGraphNodeDto[],
  edges: ProgramEvidenceGraphEdgeDto[],
): {
  nodes: ProgramEvidenceGraphNodeDto[];
  edges: ProgramEvidenceGraphEdgeDto[];
} {
  if (
    nodes.length <= MAX_PROJECTED_NODES &&
    edges.length <= MAX_PROJECTED_EDGES
  ) {
    const ids = new Set(nodes.map((node) => node.id));
    return {
      nodes,
      edges: edges.filter(
        (edge) => ids.has(edge.source) && ids.has(edge.target),
      ),
    };
  }
  const ranked = [...nodes].sort((left, right) => {
    const score = (node: ProgramEvidenceGraphNodeDto) => {
      const kind = node.kind.toUpperCase();
      return kind.includes("AI_") ||
        kind.includes("AGENT_BOUNDARY") ||
        kind.includes("HTTP_ROUTE") ||
        kind === "ENTRYPOINT"
        ? 0
        : 1;
    };
    return score(left) - score(right) || left.id.localeCompare(right.id);
  });
  const selected = new Set(ranked.slice(0, 24).map((node) => node.id));
  let expanded = true;
  while (expanded && selected.size < MAX_PROJECTED_NODES) {
    expanded = false;
    for (const edge of edges) {
      if (selected.has(edge.source) && !selected.has(edge.target)) {
        selected.add(edge.target);
        expanded = true;
      } else if (selected.has(edge.target) && !selected.has(edge.source)) {
        selected.add(edge.source);
        expanded = true;
      }
      if (selected.size >= MAX_PROJECTED_NODES) break;
    }
  }
  const projectedNodes = nodes.filter((node) => selected.has(node.id));
  const projectedEdges = edges
    .filter((edge) => selected.has(edge.source) && selected.has(edge.target))
    .sort((left, right) => left.id.localeCompare(right.id))
    .slice(0, MAX_PROJECTED_EDGES);
  return { nodes: projectedNodes, edges: projectedEdges };
}

function graphNodes(value: unknown): ProgramEvidenceGraphNodeDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const node = record(entry);
    const id = text(node?.node_id ?? node?.nodeId);
    if (!id) return [];
    const source = record(node?.source);
    return [
      {
        id,
        kind: text(node?.node_type ?? node?.nodeType) ?? "UNKNOWN",
        label: text(node?.label) ?? id,
        symbol: text(source?.symbol_ref ?? source?.symbolRef),
        file: safePath(source?.file_path ?? source?.filePath),
        line: line(
          source?.line_number ??
            source?.lineNumber ??
            source?.start_line ??
            source?.startLine,
        ),
      },
    ];
  });
}

function graphEdges(value: unknown): ProgramEvidenceGraphEdgeDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const edge = record(entry);
    const id = text(edge?.edge_id ?? edge?.edgeId);
    const source = text(
      edge?.source_node_id ?? edge?.sourceNodeId ?? edge?.source,
    );
    const target = text(
      edge?.target_node_id ?? edge?.targetNodeId ?? edge?.target,
    );
    if (!id || !source || !target) return [];
    return [
      {
        id,
        source,
        target,
        relationship:
          text(edge?.edge_type ?? edge?.edgeType ?? edge?.relationship) ??
          "RELATED",
      },
    ];
  });
}

function claims(value: unknown): ProgramEvidenceGraphClaimDto[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry, index) => {
    const claim = record(entry);
    const meaning = text(claim?.meaning ?? claim?.claim ?? claim?.description);
    if (!meaning) return [];
    return [
      {
        id:
          text(claim?.id ?? claim?.claim_id ?? claim?.claimId) ??
          `claim-${index + 1}`,
        meaning,
        symbol: text(claim?.symbol ?? claim?.symbol_ref ?? claim?.symbolRef),
        file: safePath(claim?.file ?? claim?.file_path ?? claim?.filePath),
        line: line(claim?.line ?? claim?.line_number ?? claim?.lineNumber),
        evidence_refs: strings(
          claim?.evidence_refs ?? claim?.evidenceRefs,
        ).filter(isSafeReference),
      },
    ];
  });
}

function metric(
  payload: Record<string, unknown> | null,
  keys: string[],
): number | null {
  if (!payload) return null;
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (
      typeof value === "string" &&
      value.trim() &&
      Number.isFinite(Number(value))
    )
      return Number(value);
  }
  return null;
}

function record(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}
function text(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  return /\b(token|secret|password|credential)\b/i.test(normalized) ||
    /\bgh[oprsu]_[A-Za-z0-9_]{20,}\b/.test(normalized)
    ? null
    : normalized;
}
function safePath(value: unknown): string | null {
  const path = text(value);
  if (
    !path ||
    /\b(token|secret|password|credential|authorization)\b/i.test(path)
  )
    return null;
  return path.replaceAll("\\", "/");
}
function line(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : null;
}
function strings(value: unknown): string[] {
  return Array.isArray(value)
    ? value
        .filter(
          (item): item is string =>
            typeof item === "string" && item.trim().length > 0,
        )
        .map((item) => item.trim())
    : [];
}
function isSafeReference(value: string): boolean {
  return (
    !value.includes("\\") &&
    !value.includes("/") &&
    !/\b(token|secret|password|credential|authorization)\b/i.test(value)
  );
}
