import { Injectable } from "@nestjs/common";

import { isRecord } from "../../../../../common/utils/index.js";
import type {
  ProgramEvidenceGraphClaimDto,
  ProgramEvidenceGraphDetailDto,
  ProgramEvidenceGraphEdgeDto,
  ProgramEvidenceGraphNodeDto,
  ProgramEvidenceGraphFindingDto,
  ProgramEvidenceGraphOverviewDto,
  ProgramEvidenceGraphSourceDto,
} from "../../contracts/evidence/program-evidence-graph-detail.contract.js";
import { ArtifactStorageService } from "../../../../../platform/storage/artifact-storage.service.js";

const MAX_PROJECTED_NODES = 240;
const MAX_PROJECTED_EDGES = 480;
const RANKED_SEED_NODES = 24;
const MAX_CACHED_PROJECTIONS = 8;
// Same ordering as String.prototype.localeCompare without arguments, without
// re-resolving locale data for each of the ~10^6 comparisons on large graphs.
const collator = new Intl.Collator();

type EvidenceGraphReport = {
  id: string;
  assessmentId: string;
  scanJobId: string;
  snapshotId: string;
  createdAt: Date;
};

type EvidenceGraphSnapshot = {
  repositoryFullName: string;
  branch: string | null;
  ref: string | null;
  commitSha: string;
  status: string;
} | null;

/** Projection of the immutable accepted evidence payload and its graph artifact. */
type PayloadProjection = Pick<
  ProgramEvidenceGraphDetailDto,
  "overview" | "paths" | "claims"
> & {
  finding: ProgramEvidenceGraphFindingDto | null;
  source: ProgramEvidenceGraphSourceDto | null;
};

type CachedPayloadProjection = {
  graphRef: string | null;
  artifactVersion: string | null;
  projection: PayloadProjection;
};

@Injectable()
export class ProgramEvidenceGraphDetailService {
  private readonly projections = new Map<string, CachedPayloadProjection>();

  constructor(
    private readonly storage: ArtifactStorageService = new ArtifactStorageService(),
  ) {}

  projectOverview(evidencePayload: unknown): ProgramEvidenceGraphOverviewDto {
    const payload = record(evidencePayload);
    return {
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
    };
  }

  async project(input: {
    report: EvidenceGraphReport & { evidencePayload: unknown };
    snapshot: EvidenceGraphSnapshot;
  }): Promise<ProgramEvidenceGraphDetailDto> {
    const { projection } = await this.projectPayload(
      input.report.evidencePayload,
    );
    return toDetailDto(input.report, input.snapshot, projection);
  }

  /**
   * Projects an accepted report, reusing the last projection of the same report.
   *
   * Accepted TechnicalEvidenceReport rows are never updated, so the payload-derived
   * projection is keyed by report id; the graph artifact file is additionally checked
   * by size/mtime so a rewritten artifact is always re-read. Repository snapshot fields
   * are never cached. On a hit neither the payload nor the multi-hundred-MB graph
   * artifact is loaded or parsed.
   */
  async projectAcceptedReport(input: {
    report: EvidenceGraphReport;
    snapshot: EvidenceGraphSnapshot;
    loadEvidencePayload: () => Promise<unknown>;
  }): Promise<ProgramEvidenceGraphDetailDto> {
    const cached = this.projections.get(input.report.id);
    if (
      cached &&
      (await this.artifactVersion(cached.graphRef)) === cached.artifactVersion
    ) {
      this.projections.delete(input.report.id);
      this.projections.set(input.report.id, cached);
      return toDetailDto(input.report, input.snapshot, cached.projection);
    }
    const payload = await input.loadEvidencePayload();
    const computed = await this.projectPayload(payload);
    this.projections.delete(input.report.id);
    this.projections.set(input.report.id, computed);
    while (this.projections.size > MAX_CACHED_PROJECTIONS) {
      const [oldest] = this.projections.keys();
      this.projections.delete(oldest);
    }
    return toDetailDto(input.report, input.snapshot, computed.projection);
  }

  private async projectPayload(
    evidencePayload: unknown,
  ): Promise<CachedPayloadProjection> {
    const payload = record(evidencePayload);
    const graph = record(payload?.evidence_graph ?? payload?.evidenceGraph);
    let artifact: Record<string, unknown> | null = null;
    const graphRef = text(graph?.evidence_graph_ref ?? graph?.evidenceGraphRef);
    // Capture the version before reading so a concurrent rewrite invalidates the entry.
    const artifactVersion = await this.artifactVersion(graphRef);
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
    const projectedClaims = claims(
      payload?.claims ?? payload?.evidence_claims ?? payload?.evidenceClaims,
    );

    return {
      graphRef,
      artifactVersion,
      projection: {
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
        claims: projectedClaims,
        finding: provenanceFinding(projectedClaims),
        source: provenanceSource(sourceGraph),
      },
    };
  }

  private async artifactVersion(
    graphRef: string | null,
  ): Promise<string | null> {
    if (!graphRef) return null;
    try {
      const stat = await this.storage.statJsonArtifactReference(graphRef);
      return `${stat.size}:${stat.mtimeMs}`;
    } catch {
      return null;
    }
  }
}

function toDetailDto(
  report: EvidenceGraphReport,
  snapshot: EvidenceGraphSnapshot,
  cachedProjection: PayloadProjection,
): ProgramEvidenceGraphDetailDto {
  // Responses never share mutable structure with the cached projection.
  const projection = structuredClone(cachedProjection);
  return {
    repository: {
      repository_full_name: snapshot?.repositoryFullName ?? null,
      branch: snapshot?.branch ?? null,
      ref: snapshot?.ref ?? null,
      pinned_commit: snapshot?.commitSha ?? null,
      status: snapshot?.status ?? null,
    },
    overview: projection.overview,
    paths: projection.paths,
    claims: projection.claims,
    provenance: {
      evidence_report_id: report.id,
      snapshot_id: report.snapshotId,
      scan_job_id: report.scanJobId,
      generated_at: report.createdAt.toISOString(),
      finding: projection.finding,
      source: projection.source,
    },
  };
}

function provenanceFinding(
  projectedClaims: ProgramEvidenceGraphClaimDto[],
): ProgramEvidenceGraphFindingDto | null {
  const claim = projectedClaims[0];
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
  if (!Array.isArray(graph?.nodes)) return null;
  // Single pass keeping the first minimum; equivalent to a stable sort then [0].
  let best: SourceCandidate | null = null;
  for (const entry of graph.nodes) {
    const node = record(entry);
    const source = record(node?.source);
    const file = safePath(source?.file_path ?? source?.filePath);
    if (!file || file === "<workspace>") continue;
    const candidate: SourceCandidate = {
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
    };
    if (!best || compareSourceCandidates(candidate, best) < 0) {
      best = candidate;
    }
  }
  return best;
}

type SourceCandidate = ProgramEvidenceGraphSourceDto & { file: string };

function compareSourceCandidates(
  left: SourceCandidate,
  right: SourceCandidate,
): number {
  return (
    collator.compare(left.file, right.file) ||
    (left.start_line ?? 0) - (right.start_line ?? 0) ||
    collator.compare(left.symbol ?? "", right.symbol ?? "")
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
  const selected = new Set(
    rankedSeedNodes(nodes, RANKED_SEED_NODES).map((node) => node.id),
  );
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
    .sort((left, right) => collator.compare(left.id, right.id))
    .slice(0, MAX_PROJECTED_EDGES);
  return { nodes: projectedNodes, edges: projectedEdges };
}

/**
 * First `limit` nodes of the stable order (priority kinds first, then id), selected in
 * O(n log limit) instead of sorting every node of a 10^5-node graph.
 */
function rankedSeedNodes(
  nodes: ProgramEvidenceGraphNodeDto[],
  limit: number,
): ProgramEvidenceGraphNodeDto[] {
  const top: Array<{ node: ProgramEvidenceGraphNodeDto; score: number }> = [];
  for (const node of nodes) {
    const candidate = { node, score: seedScore(node) };
    const compare = (
      left: { node: ProgramEvidenceGraphNodeDto; score: number },
      right: { node: ProgramEvidenceGraphNodeDto; score: number },
    ) =>
      left.score - right.score || collator.compare(left.node.id, right.node.id);
    if (top.length === limit && compare(candidate, top[limit - 1]) >= 0) {
      continue;
    }
    // Insert after equal elements to keep the stable-sort order for ties.
    let low = 0;
    let high = top.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (compare(top[middle], candidate) <= 0) {
        low = middle + 1;
      } else {
        high = middle;
      }
    }
    top.splice(low, 0, candidate);
    if (top.length > limit) top.pop();
  }
  return top.map((entry) => entry.node);
}

function seedScore(node: ProgramEvidenceGraphNodeDto): number {
  const kind = node.kind.toUpperCase();
  return kind.includes("AI_") ||
    kind.includes("AGENT_BOUNDARY") ||
    kind.includes("HTTP_ROUTE") ||
    kind === "ENTRYPOINT"
    ? 0
    : 1;
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
