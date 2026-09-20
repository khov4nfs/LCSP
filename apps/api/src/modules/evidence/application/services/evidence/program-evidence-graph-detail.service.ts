import { Injectable } from "@nestjs/common";
import {
  AI_DISCOVERY_EVIDENCE_STATES,
  AI_DISCOVERY_RESOLUTION_STATES,
} from "@lcsp/contracts/evidence";

import { isRecord } from "../../../../../common/utils/index.js";
import type {
  ProgramEvidenceGraphClaimDto,
  ProgramEvidenceGraphDetailDto,
  ProgramEvidenceGraphEdgeDto,
  ProgramEvidenceGraphNodeDto,
  ProgramEvidenceGraphFindingDto,
  ProgramEvidenceGraphOverviewDto,
  ProgramEvidenceGraphSourceDto,
  ProgramEvidenceGraphUsageFlowGroupDto,
} from "../../contracts/evidence/program-evidence-graph-detail.contract.js";
import { ArtifactStorageService } from "../../../../../platform/storage/artifact-storage.service.js";

const MAX_CACHED_PROJECTIONS = 8;
const MAX_AI_USAGE_PATH_DEPTH = 10;
const MAX_RENDERED_AI_USAGE_FLOWS = 64;
const MAX_OMITTED_AI_USAGE_GROUP_SUMMARIES = 4;
// Same ordering as String.prototype.localeCompare without arguments, without
// re-resolving locale data for each of the ~10^6 comparisons on large graphs.
const collator = new Intl.Collator();

const PROGRAM_GRAPH_RESOLUTION_STATES = {
  observed: AI_DISCOVERY_RESOLUTION_STATES.observed,
  corroborated: AI_DISCOVERY_RESOLUTION_STATES.corroborated,
  inferred: AI_DISCOVERY_RESOLUTION_STATES.inferred,
  unresolved: AI_DISCOVERY_RESOLUTION_STATES.unresolved,
} as const;

const PROGRAM_GRAPH_NODE_ROLES = {
  moduleFeature: "MODULE_FEATURE",
  routeHandlerFeature: "ROUTE_HANDLER_FEATURE",
  serviceClient: "SERVICE_CLIENT",
  aiSdk: "AI_SDK",
  aiSdkInvocation: "AI_SDK_INVOCATION",
  aiApiEndpoint: "AI_API_ENDPOINT",
  aiGateway: "AI_GATEWAY",
  aiProvider: "AI_PROVIDER",
  modelIdentity: "MODEL_IDENTITY",
  configControl: "CONFIG_CONTROL",
  unresolvedCandidate: "UNRESOLVED_AI_CANDIDATE",
} as const;

const AI_USAGE_SEED_KINDS = new Set([
  "AI_MODEL_INVOCATION",
  "AI_API_CANDIDATE",
  "AI_GATEWAY",
  "UNRESOLVED_DYNAMIC_TARGET",
]);

const AI_CONTEXT_NODE_KINDS = new Set([
  "REPOSITORY",
  "PACKAGE",
  "MODULE",
  "FILE",
  "PACKAGE_DEPENDENCY",
  "HTTP_ROUTE",
  "GRPC_METHOD",
  "GRAPHQL_OPERATION",
  "WEBHOOK",
  "COMMAND",
  "QUERY",
  "CRON",
  "BUSINESS_ACTION",
  "AGENT_BOUNDARY_SOURCE",
  "CLASS",
  "FUNCTION",
  "METHOD",
  "CALL_SITE",
  "SDK_CLIENT",
  "EXTERNAL_API",
  "AI_API_CANDIDATE",
  "AI_GATEWAY",
  "AI_PROVIDER",
  "AI_MODEL_INVOCATION",
  "UNRESOLVED_DYNAMIC_TARGET",
  "CONFIG_SOURCE",
  "ENV_SOURCE",
  "CONTROL_CONDITION",
  "FEATURE_FLAG",
  "MODEL",
  "MODEL_ENDPOINT",
]);

const AI_PATH_SOURCE_KINDS = new Set([
  "MODULE",
  "PACKAGE",
  "FILE",
  "HTTP_ROUTE",
  "GRPC_METHOD",
  "GRAPHQL_OPERATION",
  "WEBHOOK",
  "COMMAND",
  "QUERY",
  "CRON",
  "BUSINESS_ACTION",
  "AGENT_BOUNDARY_SOURCE",
]);

const AI_PATH_EDGE_TYPES = new Set([
  "CONTAINS",
  "DECLARES",
  "DEPENDS_ON",
  "IMPORTS",
  "EXPORTS",
  "HANDLED_BY",
  "CALLS",
  "CALLS_API",
  "CALLS_DYNAMICALLY",
  "CALLS_EXTERNAL",
  "INVOKES_BOUNDARY",
  "SENDS_TO_AI",
  "INVOKES_AI",
  "RESOLVES_TO",
  "CONFIGURES",
  "CONTROLS",
  "GUARDS",
  "FLOWS_TO",
]);

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
    const paths = projectAiUsageGraph(
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
        paths,
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

type InternalProgramEvidenceGraphNode = ProgramEvidenceGraphNodeDto & {
  attributes: Record<string, unknown> | null;
  evidence_refs: string[];
  support_refs: string[];
  coverage_state: string | null;
  origin: string | null;
};

type InternalProgramEvidenceGraphEdge = ProgramEvidenceGraphEdgeDto & {
  attributes: Record<string, unknown> | null;
  evidence_refs: string[];
  support_refs: string[];
  coverage_state: string | null;
  origin: string | null;
};

type AiUsageFlowProjection = {
  seed: InternalProgramEvidenceGraphNode;
  path: {
    nodes: InternalProgramEvidenceGraphNode[];
    edges: InternalProgramEvidenceGraphEdge[];
  };
  groupKey: string;
  groupLabel: string;
  source: InternalProgramEvidenceGraphNode | null;
  providerLabel: string | null;
  gatewayLabel: string | null;
};

type AiUsageFlowGroup = {
  key: string;
  label: string;
  source: InternalProgramEvidenceGraphNode | null;
  providerLabel: string | null;
  gatewayLabel: string | null;
  flows: AiUsageFlowProjection[];
};

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

function projectAiUsageGraph(
  nodes: InternalProgramEvidenceGraphNode[],
  edges: InternalProgramEvidenceGraphEdge[],
): ProgramEvidenceGraphDetailDto["paths"] {
  const nodeById = new Map(nodes.map((node) => [node.id, node]));
  const validEdges = edges.filter(
    (edge) => nodeById.has(edge.source) && nodeById.has(edge.target),
  );
  const incoming = new Map<string, InternalProgramEvidenceGraphEdge[]>();
  for (const edge of validEdges) {
    if (!AI_PATH_EDGE_TYPES.has(edge.relationship.toUpperCase())) continue;
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  }
  const seedNodes = nodes.filter(isAiUsageSeedNode).sort(compareAiSeedNodes);
  if (!seedNodes.length) {
    return {
      nodes: [],
      edges: [],
      usage_flow_count: 0,
      rendered_usage_flow_count: 0,
      omitted_usage_flow_count: 0,
      usage_group_count: 0,
      rendered_usage_group_count: 0,
      omitted_usage_group_count: 0,
      usage_flow_groups: [],
    };
  }

  const flows = seedNodes.map((seed) => {
    const path = strongestPathToAiSeed(seed, incoming, nodeById);
    return buildAiUsageFlowProjection(seed, path, nodeById);
  });
  const groups = groupAiUsageFlows(flows);
  const renderedFlows = selectRenderedAiUsageFlows(groups);
  const renderedSeedNodes = renderedFlows.map((flow) => flow.seed);
  const renderedSeedIds = new Set(renderedSeedNodes.map((seed) => seed.id));
  const renderedGroupCount = groups.filter((group) =>
    group.flows.some((flow) => renderedSeedIds.has(flow.seed.id)),
  ).length;
  const selectedNodes = new Map<string, InternalProgramEvidenceGraphNode>();
  const selectedEdges = new Map<string, InternalProgramEvidenceGraphEdge>();
  for (const flow of renderedFlows) {
    for (const node of flow.path.nodes) selectedNodes.set(node.id, node);
    for (const edge of flow.path.edges) selectedEdges.set(edge.id, edge);
    selectedNodes.set(flow.seed.id, flow.seed);
    appendGovernedProviderProjection(flow.seed, selectedNodes, selectedEdges);
  }

  const projectedNodes = sortAiUsageNodes(
    [...selectedNodes.values()]
      .filter((node) => AI_CONTEXT_NODE_KINDS.has(node.kind.toUpperCase()))
      .map(toPublicNode),
    renderedSeedNodes,
  );
  const projectedNodeIds = new Set(projectedNodes.map((node) => node.id));
  const projectedEdges = [...selectedEdges.values()]
    .filter(
      (edge) =>
        projectedNodeIds.has(edge.source) && projectedNodeIds.has(edge.target),
    )
    .map(toPublicEdge)
    .sort((left, right) => collator.compare(left.id, right.id));
  return {
    nodes: projectedNodes,
    edges: projectedEdges,
    usage_flow_count: seedNodes.length,
    rendered_usage_flow_count: renderedSeedNodes.length,
    omitted_usage_flow_count: seedNodes.length - renderedSeedNodes.length,
    usage_group_count: groups.length,
    rendered_usage_group_count: renderedGroupCount,
    omitted_usage_group_count: groups.length - renderedGroupCount,
    usage_flow_groups: selectUsageFlowGroupSummaries(groups, renderedSeedIds),
  };
}

function buildAiUsageFlowProjection(
  seed: InternalProgramEvidenceGraphNode,
  path: {
    nodes: InternalProgramEvidenceGraphNode[];
    edges: InternalProgramEvidenceGraphEdge[];
  },
  nodeById: Map<string, InternalProgramEvidenceGraphNode>,
): AiUsageFlowProjection {
  const source = aiUsageSourceNode(path, nodeById);
  const providerLabel = governedProviderLabel(seed);
  const gatewayLabel = aiUsageGatewayLabel(seed, providerLabel);
  const sourceKey = source ? `${source.kind}:${source.id}` : "UNRESOLVED";
  const targetKey = providerLabel
    ? `PROVIDER:${providerLabel}`
    : gatewayLabel
      ? `GATEWAY:${gatewayLabel}`
      : `USAGE:${seed.kind}`;
  const sourceLabel = source?.label ?? "Unresolved source";
  const targetLabel = providerLabel ?? gatewayLabel ?? seed.kind;
  return {
    seed,
    path,
    groupKey: `${sourceKey}|${targetKey}`,
    groupLabel: `${sourceLabel} -> ${targetLabel}`,
    source,
    providerLabel,
    gatewayLabel,
  };
}

function aiUsageSourceNode(
  path: {
    nodes: InternalProgramEvidenceGraphNode[];
    edges: InternalProgramEvidenceGraphEdge[];
  },
  nodeById: Map<string, InternalProgramEvidenceGraphNode>,
): InternalProgramEvidenceGraphNode | null {
  const edgeSource = path.edges[0]?.source;
  if (edgeSource) {
    const source = nodeById.get(edgeSource);
    if (source && AI_PATH_SOURCE_KINDS.has(source.kind.toUpperCase())) {
      return source;
    }
  }
  return (
    path.nodes.find(
      (node) =>
        node.kind.toUpperCase() !== "AI_MODEL_INVOCATION" &&
        AI_PATH_SOURCE_KINDS.has(node.kind.toUpperCase()),
    ) ?? null
  );
}

function governedProviderLabel(
  seed: InternalProgramEvidenceGraphNode,
): string | null {
  const provider = text(seed.attributes?.provider);
  const isObservedSdkInvocation =
    seed.kind.toUpperCase() === "AI_MODEL_INVOCATION" &&
    (seed.resolution_state === PROGRAM_GRAPH_RESOLUTION_STATES.observed ||
      seed.resolution_state === PROGRAM_GRAPH_RESOLUTION_STATES.corroborated);
  if (
    !provider ||
    (seed.evidence_state !== AI_DISCOVERY_EVIDENCE_STATES.confirmedAiCall &&
      !isObservedSdkInvocation) ||
    seed.resolution_state === PROGRAM_GRAPH_RESOLUTION_STATES.unresolved
  ) {
    return null;
  }
  return provider;
}

function aiUsageGatewayLabel(
  seed: InternalProgramEvidenceGraphNode,
  providerLabel: string | null,
): string | null {
  if (providerLabel) return null;
  const kind = seed.kind.toUpperCase();
  if (kind === "AI_GATEWAY" || kind === "AI_API_CANDIDATE") {
    return seed.label;
  }
  if (kind === "UNRESOLVED_DYNAMIC_TARGET") {
    return seed.label;
  }
  return null;
}

function groupAiUsageFlows(flows: AiUsageFlowProjection[]): AiUsageFlowGroup[] {
  const groups = new Map<string, AiUsageFlowGroup>();
  for (const flow of flows) {
    const existing = groups.get(flow.groupKey);
    if (existing) {
      existing.flows.push(flow);
      continue;
    }
    groups.set(flow.groupKey, {
      key: flow.groupKey,
      label: flow.groupLabel,
      source: flow.source,
      providerLabel: flow.providerLabel,
      gatewayLabel: flow.gatewayLabel,
      flows: [flow],
    });
  }
  const sortedGroups = [...groups.values()].sort(compareAiUsageFlowGroups);
  for (const group of sortedGroups) {
    group.flows.sort((left, right) =>
      compareAiSeedNodes(left.seed, right.seed),
    );
  }
  return sortedGroups;
}

function selectRenderedAiUsageFlows(
  groups: AiUsageFlowGroup[],
): AiUsageFlowProjection[] {
  const selected = new Map<string, AiUsageFlowProjection>();
  for (const group of groups) {
    const representative = group.flows[0];
    if (!representative) continue;
    selected.set(representative.seed.id, representative);
    if (selected.size >= MAX_RENDERED_AI_USAGE_FLOWS) {
      return [...selected.values()];
    }
  }
  const remaining = groups
    .flatMap((group) => group.flows.slice(1))
    .sort((left, right) => compareAiSeedNodes(left.seed, right.seed));
  for (const flow of remaining) {
    selected.set(flow.seed.id, flow);
    if (selected.size >= MAX_RENDERED_AI_USAGE_FLOWS) break;
  }
  return [...selected.values()].sort((left, right) =>
    compareAiSeedNodes(left.seed, right.seed),
  );
}

function compareAiUsageFlowGroups(
  left: AiUsageFlowGroup,
  right: AiUsageFlowGroup,
): number {
  const leftRepresentative = left.flows[0]?.seed;
  const rightRepresentative = right.flows[0]?.seed;
  return (
    (leftRepresentative && rightRepresentative
      ? compareAiSeedNodes(leftRepresentative, rightRepresentative)
      : 0) ||
    collator.compare(left.label, right.label) ||
    collator.compare(left.key, right.key)
  );
}

function selectUsageFlowGroupSummaries(
  groups: AiUsageFlowGroup[],
  renderedSeedIds: Set<string>,
): ProgramEvidenceGraphUsageFlowGroupDto[] {
  const renderedGroups: ProgramEvidenceGraphUsageFlowGroupDto[] = [];
  const omittedGroups: ProgramEvidenceGraphUsageFlowGroupDto[] = [];
  for (const group of groups) {
    const dto = toUsageFlowGroupDto(group, renderedSeedIds);
    if (dto.rendered_usage_flow_count > 0) {
      renderedGroups.push(dto);
    } else if (dto.omitted_usage_flow_count > 0) {
      omittedGroups.push(dto);
    }
  }
  return [
    ...renderedGroups,
    ...omittedGroups.slice(0, MAX_OMITTED_AI_USAGE_GROUP_SUMMARIES),
  ];
}

function toUsageFlowGroupDto(
  group: AiUsageFlowGroup,
  renderedSeedIds: Set<string>,
): ProgramEvidenceGraphUsageFlowGroupDto {
  const renderedCount = group.flows.filter((flow) =>
    renderedSeedIds.has(flow.seed.id),
  ).length;
  return {
    key: group.key,
    label: group.label,
    source_node_id: group.source?.id ?? null,
    source_label: group.source?.label ?? null,
    provider_label: group.providerLabel,
    gateway_label: group.gatewayLabel,
    usage_flow_count: group.flows.length,
    rendered_usage_flow_count: renderedCount,
    omitted_usage_flow_count: group.flows.length - renderedCount,
  };
}

function sortAiUsageNodes(
  nodes: ProgramEvidenceGraphNodeDto[],
  seedNodes: InternalProgramEvidenceGraphNode[],
): ProgramEvidenceGraphNodeDto[] {
  const seedIds = new Set(seedNodes.map((node) => node.id));
  return [...nodes].sort(
    (left, right) =>
      Number(!seedIds.has(left.id)) - Number(!seedIds.has(right.id)) ||
      aiKindPriority(left.kind) - aiKindPriority(right.kind) ||
      collator.compare(left.id, right.id),
  );
}

function strongestPathToAiSeed(
  seed: InternalProgramEvidenceGraphNode,
  incoming: Map<string, InternalProgramEvidenceGraphEdge[]>,
  nodeById: Map<string, InternalProgramEvidenceGraphNode>,
): {
  nodes: InternalProgramEvidenceGraphNode[];
  edges: InternalProgramEvidenceGraphEdge[];
} {
  const queue: Array<{
    nodeId: string;
    edges: InternalProgramEvidenceGraphEdge[];
    score: number;
  }> = [{ nodeId: seed.id, edges: [], score: 0 }];
  const visited = new Map<string, number>([[seed.id, 0]]);
  let best: {
    node: InternalProgramEvidenceGraphNode;
    edges: InternalProgramEvidenceGraphEdge[];
    score: number;
  } | null = null;
  let fallback: InternalProgramEvidenceGraphEdge[] = [];

  while (queue.length) {
    queue.sort(
      (left, right) =>
        left.score - right.score ||
        left.edges.length - right.edges.length ||
        collator.compare(left.nodeId, right.nodeId),
    );
    const current = queue.shift();
    if (!current) break;
    const currentNode = nodeById.get(current.nodeId);
    if (!currentNode) continue;
    if (current.edges.length > fallback.length) fallback = current.edges;
    if (
      current.nodeId !== seed.id &&
      AI_PATH_SOURCE_KINDS.has(currentNode.kind.toUpperCase())
    ) {
      const candidate = {
        node: currentNode,
        edges: current.edges,
        score: current.score + sourceKindCost(currentNode.kind),
      };
      if (
        !best ||
        candidate.score < best.score ||
        (candidate.score === best.score &&
          candidate.edges.length > best.edges.length)
      ) {
        best = candidate;
      }
    }
    if (current.edges.length >= MAX_AI_USAGE_PATH_DEPTH) continue;
    for (const edge of incoming.get(current.nodeId) ?? []) {
      const source = nodeById.get(edge.source);
      if (!source || !AI_CONTEXT_NODE_KINDS.has(source.kind.toUpperCase())) {
        continue;
      }
      const nextScore = current.score + evidenceCost(edge);
      if ((visited.get(source.id) ?? Number.POSITIVE_INFINITY) <= nextScore) {
        continue;
      }
      visited.set(source.id, nextScore);
      queue.push({
        nodeId: source.id,
        edges: [edge, ...current.edges],
        score: nextScore,
      });
    }
  }

  const pathEdges = best?.edges ?? fallback;
  const pathNodeIds = new Set<string>([seed.id]);
  for (const edge of pathEdges) {
    pathNodeIds.add(edge.source);
    pathNodeIds.add(edge.target);
  }
  return {
    nodes: [...pathNodeIds]
      .map((id) => nodeById.get(id))
      .filter((node): node is InternalProgramEvidenceGraphNode =>
        Boolean(node),
      ),
    edges: pathEdges,
  };
}

function sourceKindCost(kind: string): number {
  switch (kind.toUpperCase()) {
    case "MODULE":
    case "PACKAGE":
    case "FILE":
      return 0;
    case "HTTP_ROUTE":
    case "GRPC_METHOD":
    case "GRAPHQL_OPERATION":
    case "WEBHOOK":
    case "COMMAND":
    case "QUERY":
    case "CRON":
    case "BUSINESS_ACTION":
    case "AGENT_BOUNDARY_SOURCE":
      return 2;
    default:
      return 4;
  }
}

function appendGovernedProviderProjection(
  node: InternalProgramEvidenceGraphNode,
  selectedNodes: Map<string, InternalProgramEvidenceGraphNode>,
  selectedEdges: Map<string, InternalProgramEvidenceGraphEdge>,
) {
  const provider = text(node.attributes?.provider);
  const isObservedSdkInvocation =
    node.kind.toUpperCase() === "AI_MODEL_INVOCATION" &&
    (node.resolution_state === PROGRAM_GRAPH_RESOLUTION_STATES.observed ||
      node.resolution_state === PROGRAM_GRAPH_RESOLUTION_STATES.corroborated);
  if (
    !provider ||
    (node.evidence_state !== AI_DISCOVERY_EVIDENCE_STATES.confirmedAiCall &&
      !isObservedSdkInvocation) ||
    node.resolution_state === PROGRAM_GRAPH_RESOLUTION_STATES.unresolved
  ) {
    return;
  }
  const providerId = `projection-provider:${node.id}:${provider}`;
  selectedNodes.set(providerId, {
    id: providerId,
    kind: "AI_PROVIDER",
    label: provider,
    symbol: null,
    file: null,
    line: null,
    ai_usage_role: PROGRAM_GRAPH_NODE_ROLES.aiProvider,
    evidence_state: AI_DISCOVERY_EVIDENCE_STATES.aiProviderReference,
    resolution_state: node.resolution_state,
    attributes: null,
    evidence_refs: node.evidence_refs,
    support_refs: node.support_refs,
    coverage_state: node.coverage_state,
    origin: node.origin,
  });
  selectedEdges.set(`projection-provider-edge:${node.id}:${provider}`, {
    id: `projection-provider-edge:${node.id}:${provider}`,
    source: node.id,
    target: providerId,
    relationship: "RESOLVES_TO",
    evidence_state: AI_DISCOVERY_EVIDENCE_STATES.aiProviderReference,
    resolution_state: node.resolution_state,
    attributes: null,
    evidence_refs: node.evidence_refs,
    support_refs: node.support_refs,
    coverage_state: node.coverage_state,
    origin: node.origin,
  });
}

function isAiUsageSeedNode(node: InternalProgramEvidenceGraphNode): boolean {
  const kind = node.kind.toUpperCase();
  if (!AI_USAGE_SEED_KINDS.has(kind)) return false;
  if (
    kind === "AI_MODEL_INVOCATION" &&
    node.resolution_state !== PROGRAM_GRAPH_RESOLUTION_STATES.unresolved
  ) {
    return true;
  }
  if (kind === "AI_API_CANDIDATE") {
    return (
      node.evidence_state === AI_DISCOVERY_EVIDENCE_STATES.confirmedAiCall ||
      node.evidence_state === AI_DISCOVERY_EVIDENCE_STATES.possibleAiCall
    );
  }
  if (kind === "UNRESOLVED_DYNAMIC_TARGET") {
    return booleanAttribute(node.attributes?.aiMaterial);
  }
  if (kind === "AI_GATEWAY") {
    return (
      booleanAttribute(node.attributes?.aiMaterial) ||
      node.evidence_state === AI_DISCOVERY_EVIDENCE_STATES.confirmedAiCall ||
      node.evidence_state === AI_DISCOVERY_EVIDENCE_STATES.possibleAiCall
    );
  }
  return false;
}

function compareAiSeedNodes(
  left: InternalProgramEvidenceGraphNode,
  right: InternalProgramEvidenceGraphNode,
): number {
  return (
    evidenceCost(left) - evidenceCost(right) ||
    aiKindPriority(left.kind) - aiKindPriority(right.kind) ||
    collator.compare(left.id, right.id)
  );
}

function aiKindPriority(kind: string): number {
  switch (kind.toUpperCase()) {
    case "AI_MODEL_INVOCATION":
      return 0;
    case "AI_API_CANDIDATE":
      return 1;
    case "AI_GATEWAY":
      return 2;
    case "UNRESOLVED_DYNAMIC_TARGET":
      return 3;
    default:
      return 5;
  }
}

function evidenceCost(
  item: Pick<
    ProgramEvidenceGraphNodeDto | ProgramEvidenceGraphEdgeDto,
    "resolution_state" | "evidence_state"
  >,
): number {
  const resolution = item.resolution_state;
  const evidence = item.evidence_state;
  if (
    resolution === PROGRAM_GRAPH_RESOLUTION_STATES.observed ||
    resolution === PROGRAM_GRAPH_RESOLUTION_STATES.corroborated
  ) {
    return evidence === AI_DISCOVERY_EVIDENCE_STATES.possibleAiCall ? 1 : 0;
  }
  if (resolution === PROGRAM_GRAPH_RESOLUTION_STATES.inferred) return 2;
  if (resolution === PROGRAM_GRAPH_RESOLUTION_STATES.unresolved) return 5;
  return 3;
}

function toPublicNode(
  node: InternalProgramEvidenceGraphNode,
): ProgramEvidenceGraphNodeDto {
  return {
    id: node.id,
    kind: node.kind,
    label: node.label,
    symbol: node.symbol,
    file: node.file,
    line: node.line,
    ai_usage_role: node.ai_usage_role ?? roleForNode(node),
    evidence_state: node.evidence_state,
    resolution_state: node.resolution_state,
  };
}

function toPublicEdge(
  edge: InternalProgramEvidenceGraphEdge,
): ProgramEvidenceGraphEdgeDto {
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    relationship: edge.relationship,
    evidence_state: edge.evidence_state,
    resolution_state: edge.resolution_state,
  };
}

function roleForNode(node: InternalProgramEvidenceGraphNode): string {
  const kind = node.kind.toUpperCase();
  if (["REPOSITORY", "PACKAGE", "MODULE", "FILE"].includes(kind)) {
    return PROGRAM_GRAPH_NODE_ROLES.moduleFeature;
  }
  if (
    [
      "HTTP_ROUTE",
      "GRPC_METHOD",
      "GRAPHQL_OPERATION",
      "WEBHOOK",
      "COMMAND",
      "QUERY",
      "CRON",
      "BUSINESS_ACTION",
      "AGENT_BOUNDARY_SOURCE",
    ].includes(kind)
  ) {
    return PROGRAM_GRAPH_NODE_ROLES.routeHandlerFeature;
  }
  if (kind === "SDK_CLIENT" || kind === "PACKAGE_DEPENDENCY") {
    return PROGRAM_GRAPH_NODE_ROLES.aiSdk;
  }
  if (kind === "AI_MODEL_INVOCATION") {
    return PROGRAM_GRAPH_NODE_ROLES.aiSdkInvocation;
  }
  if (kind === "AI_API_CANDIDATE" || kind === "EXTERNAL_API") {
    return PROGRAM_GRAPH_NODE_ROLES.aiApiEndpoint;
  }
  if (kind === "AI_GATEWAY") return PROGRAM_GRAPH_NODE_ROLES.aiGateway;
  if (kind === "AI_PROVIDER") return PROGRAM_GRAPH_NODE_ROLES.aiProvider;
  if (kind === "MODEL" || kind === "MODEL_ENDPOINT") {
    return PROGRAM_GRAPH_NODE_ROLES.modelIdentity;
  }
  if (
    kind === "CONFIG_SOURCE" ||
    kind === "ENV_SOURCE" ||
    kind === "CONTROL_CONDITION" ||
    kind === "FEATURE_FLAG"
  ) {
    return PROGRAM_GRAPH_NODE_ROLES.configControl;
  }
  if (kind === "UNRESOLVED_DYNAMIC_TARGET") {
    return PROGRAM_GRAPH_NODE_ROLES.unresolvedCandidate;
  }
  return PROGRAM_GRAPH_NODE_ROLES.serviceClient;
}

function graphNodes(value: unknown): InternalProgramEvidenceGraphNode[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const node = record(entry);
    const id = text(node?.node_id ?? node?.nodeId);
    if (!id) return [];
    const source = record(node?.source);
    const attributes = safeAttributes(node?.attributes);
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
        ai_usage_role: null,
        evidence_state: discoveryState(attributes),
        resolution_state: resolutionState(
          node?.resolution_state ?? node?.resolutionState,
        ),
        attributes,
        evidence_refs: strings(
          node?.evidence_refs ?? node?.evidenceRefs,
        ).filter(isSafeReference),
        support_refs: strings(node?.support_refs ?? node?.supportRefs).filter(
          isSafeReference,
        ),
        coverage_state: text(node?.coverage_state ?? node?.coverageState),
        origin: text(node?.origin),
      },
    ];
  });
}

function graphEdges(value: unknown): InternalProgramEvidenceGraphEdge[] {
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
    const attributes = safeAttributes(edge?.attributes);
    return [
      {
        id,
        source,
        target,
        relationship:
          text(edge?.edge_type ?? edge?.edgeType ?? edge?.relationship) ??
          "RELATED",
        evidence_state: discoveryState(attributes),
        resolution_state: resolutionState(
          edge?.resolution_state ?? edge?.resolutionState,
        ),
        attributes,
        evidence_refs: strings(
          edge?.evidence_refs ?? edge?.evidenceRefs,
        ).filter(isSafeReference),
        support_refs: strings(edge?.support_refs ?? edge?.supportRefs).filter(
          isSafeReference,
        ),
        coverage_state: text(edge?.coverage_state ?? edge?.coverageState),
        origin: text(edge?.origin),
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
function safeAttributes(value: unknown): Record<string, unknown> | null {
  const attrs = record(value);
  if (!attrs) return null;
  const safe: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(attrs)) {
    if (!isSafeAttributeName(key)) continue;
    if (typeof raw === "boolean") {
      safe[key] = raw;
    } else if (typeof raw === "number" && Number.isFinite(raw)) {
      safe[key] = raw;
    } else if (typeof raw === "string") {
      const value = text(raw);
      if (value) safe[key] = value.slice(0, 240);
    } else if (Array.isArray(raw)) {
      const values = raw
        .map((item) => text(item))
        .filter((item): item is string => Boolean(item))
        .slice(0, 8);
      if (values.length) safe[key] = values;
    }
  }
  return Object.keys(safe).length ? safe : null;
}
function isSafeAttributeName(value: string): boolean {
  return !/\b(token|secret|password|credential|authorization)\b/i.test(value);
}
function discoveryState(attrs: Record<string, unknown> | null): string | null {
  const state = text(attrs?.discoveryState ?? attrs?.discovery_state);
  return state &&
    (Object.values(AI_DISCOVERY_EVIDENCE_STATES) as readonly string[]).includes(
      state,
    )
    ? state
    : null;
}
function resolutionState(value: unknown): string {
  const state = text(value);
  return state &&
    (
      Object.values(PROGRAM_GRAPH_RESOLUTION_STATES) as readonly string[]
    ).includes(state)
    ? state
    : PROGRAM_GRAPH_RESOLUTION_STATES.unresolved;
}
function booleanAttribute(value: unknown): boolean {
  return value === true || value === "true" || value === "TRUE";
}
function isSafeReference(value: string): boolean {
  return (
    !value.includes("\\") &&
    !value.includes("/") &&
    !/\b(token|secret|password|credential|authorization)\b/i.test(value)
  );
}
